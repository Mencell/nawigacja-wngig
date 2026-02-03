# Nawigacja WNGIG

System nawigacji wewnętrznej dla budynku Wydziału Nauk Geograficznych i Geologicznych.

## Technologie

### Backend
- **Flask** - framework webowy Python
- **PostgreSQL** + **PostGIS** - baza danych przestrzennych
- **pgRouting** - wyznaczanie tras
- **psycopg2** - połączenie z bazą danych

### Frontend
- **Leaflet** - biblioteka map interaktywnych
- **Proj4Leaflet** - obsługa niestandardowych układów współrzędnych (EPSG:2180)
- **HTML5 QR Code Scanner** - skanowanie kodów QR

## Funkcjonalności

- 🗺️ Interaktywna mapa budynku (2 piętra: parter i poziom -1)
- 🎯 Wyznaczanie najkrótszej trasy między punktami
- ♿ Opcja unikania schodów (dla osób z niepełnosprawnościami)
- 📱 Skanowanie kodów QR do szybkiego wyboru punktu startowego
- 🏢 Nawigacja wielopiętrowa
- 📍 Kliknięcie na mapie do wyboru punktu

## Instalacja

### Wymagania
- Python 3.8+
- PostgreSQL 12+ z rozszerzeniami PostGIS i pgRouting
- Node.js (opcjonalnie, dla narzędzi deweloperskich)

### Uruchomienie

1. Zainstaluj zależności Python:
```bash
pip install -r requirements.txt
# lub używając Poetry:
poetry install
```

2. Skonfiguruj bazę danych w `app.py`:
```python
DB_CONFIG = {
    "dbname": "nawigacja_v3",
    "user": "twoj_user",
    "password": "twoje_haslo",
    "host": "localhost",
    "port": "5432"
}
```

3. Uruchom aplikację:
```bash
python app.py
```

4. Otwórz przeglądarkę: `http://localhost:5001`

## Struktura projektu

```
nawigacja/
├── app.py                      # Backend Flask
├── static/
│   ├── css/
│   │   └── style.css          # Style aplikacji
│   ├── js/
│   │   └── app.js             # Logika frontendowa
│   ├── floorplan.geojson      # Mapa poziomu -1
│   └── floorplan_0.geojson    # Mapa parteru
├── templates/
│   └── index.html             # Szablon HTML
└── model_budynku.gpkg         # Model 3D budynku (GeoPackage)
```

## Autor

Projekt dyplomowy - Wydział Nauk Geograficznych i Geologicznych
