import json

import psycopg2
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from psycopg2 import pool

app = Flask(__name__)
CORS(app)

# Konfiguracja bazy danych
# UWAGA: Dostosuj parametry do swojego środowiska
DB_CONFIG = {
    "dbname": "nawigacja_v3",
    "user": "postgres",
    "password": "",
    "host": "localhost",
    "port": "5432"
}


try:
    connection_pool = pool.SimpleConnectionPool(1, 10, **DB_CONFIG)
except (Exception, psycopg2.DatabaseError) as error:
    print(f"Błąd połączenia z bazą danych: {error}")

def get_db_connection():
    """Pobiera połączenie z puli."""
    return connection_pool.getconn()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/locations')
def get_locations():
    """Pobiera listę punktów docelowych wraz z informacją o piętrze."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        
        cur.execute("""
            SELECT typ, opis, pietro 
            FROM public.punkty_docelowe 
            ORDER BY typ ASC, opis ASC
        """)
        
        rows = cur.fetchall()
        cur.close()
        
        grouped_locations = {}
        location_floors = {} 

        for row in rows:
            typ, opis, pietro = row
            if typ not in grouped_locations:
                grouped_locations[typ] = []
            if opis not in grouped_locations[typ]:
                grouped_locations[typ].append(opis)
            location_floors[opis] = pietro
        
        return jsonify({
            "groups": grouped_locations,
            "floors": location_floors
        })
    finally:
        connection_pool.putconn(conn)

@app.route('/api/route', methods=['POST'])
def get_route():
    data = request.json
    start_label = data.get('start')
    end_label = data.get('end')
    start_geo = data.get('start_geometry')
    end_geo = data.get('end_geometry')
    avoid_stairs = data.get('avoid_stairs', False)

    if not start_label or not end_label:
        return jsonify({"error": "Brak punktów"}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        def get_candidate_ids(label, geo_json):
            """Znajduje ID węzłów pasujących do etykiety, opcjonalnie filtrując po geometrii."""
            if geo_json:
                # Wybierz najbliższy węzeł o podanej nazwie (dla wielokrotnych lokalizacji jak WC)
                geo_str = json.dumps(geo_json)
                query = """
                    SELECT id_wezla 
                    FROM public.punkty_docelowe 
                    WHERE opis = %s 
                    ORDER BY geom <-> ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 2180) 
                    LIMIT 1
                """
                cur.execute(query, (label, geo_str))
            else:
                # Pobierz wszystkie węzły o tej nazwie
                query = "SELECT id_wezla FROM public.punkty_docelowe WHERE opis = %s"
                cur.execute(query, (label,))
            
            return [row[0] for row in cur.fetchall()]

        start_ids = get_candidate_ids(start_label, start_geo)
        end_ids = get_candidate_ids(end_label, end_geo)

        if not start_ids:
            return jsonify({"error": f"Nie znaleziono punktu startowego: {start_label}"}), 404
        if not end_ids:
            return jsonify({"error": f"Nie znaleziono punktu końcowego: {end_label}"}), 404

        # Przygotuj zapytanie z uwzględnieniem opcji unikania schodów
        if avoid_stairs:
            inner_sql = """
                SELECT fid AS id, source, target, 
                    CASE 
                        WHEN typ = 'Schody' THEN cost * 1000000 
                        WHEN typ = 'pion' AND opis LIKE 'schody%%' THEN cost * 1000000
                        ELSE cost 
                    END as cost,
                    CASE 
                        WHEN typ = 'Schody' THEN reverse_cost * 1000000 
                        WHEN typ = 'pion' AND opis LIKE 'schody%%' THEN reverse_cost * 1000000
                        ELSE reverse_cost 
                    END as reverse_cost
                FROM public.osie
            """
        else:
            inner_sql = """
                SELECT fid AS id, source, target, cost, reverse_cost 
                FROM public.osie
            """
        
        safe_inner_sql = inner_sql.replace("'", "''")

        # Konwersja list na tablice SQL
        start_ids_str = "ARRAY[" + ",".join(map(str, start_ids)) + "]"
        end_ids_str = "ARRAY[" + ",".join(map(str, end_ids)) + "]"

        # pgr_dijkstra - znajduje najkrótszą trasę między zestawami punktów
        
        sql_query = f"""
            WITH all_routes AS (
                SELECT start_vid, end_vid, agg_cost
                FROM pgr_dijkstra(
                    '{safe_inner_sql}',
                    {start_ids_str},
                    {end_ids_str},
                    TRUE
                )
            ),
            route_totals AS (
                SELECT start_vid, end_vid, MAX(agg_cost) as total_cost
                FROM all_routes
                GROUP BY start_vid, end_vid
            ),
            best_route AS (
                SELECT start_vid, end_vid, total_cost as agg_cost
                FROM route_totals
                ORDER BY total_cost ASC
                LIMIT 1
            ),
            full_path AS (
                SELECT di.agg_cost, net.geom, net.pietro, net.typ
                FROM pgr_dijkstra(
                    '{safe_inner_sql}',
                    (SELECT start_vid FROM best_route),
                    (SELECT end_vid FROM best_route),
                    TRUE
                ) AS di
                JOIN public.osie AS net ON di.edge = net.fid
            )
            SELECT
                (SELECT MAX(agg_cost) FROM full_path) AS total_distance,
                (SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) 
                 FROM public.punkty_docelowe 
                 WHERE id_wezla = (SELECT start_vid FROM best_route)) AS start_point,
                (SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) 
                 FROM public.punkty_docelowe 
                 WHERE id_wezla = (SELECT end_vid FROM best_route)) AS end_point,
                (SELECT json_agg(row_to_json(r)) FROM (
                    SELECT ST_AsGeoJSON(ST_Transform(geom, 4326))::json as geometry, pietro, typ 
                    FROM full_path
                ) r) as route_segments,
                (SELECT pietro FROM public.punkty_docelowe 
                 WHERE id_wezla = (SELECT start_vid FROM best_route)) AS start_floor,
                (SELECT pietro FROM public.punkty_docelowe 
                 WHERE id_wezla = (SELECT end_vid FROM best_route)) AS end_floor
        """

        cur.execute(sql_query)
        result = cur.fetchone()

        if result and result[0] is not None:
            return jsonify({
                "distance": result[0],
                "start_point": result[1],
                "end_point": result[2],
                "segments": result[3],
                "start_floor": result[4],
                "end_floor": result[5]
            })
        else:
            return jsonify({"error": "Nie znaleziono trasy między wybranymi punktami."}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if cur: cur.close()
        connection_pool.putconn(conn)

if __name__ == '__main__':
    # Dla produkcji ustaw debug=False
    app.run(debug=False, port=5001)