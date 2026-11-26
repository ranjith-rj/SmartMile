# Smart Mileage Tracker
Extract the ZIP, open the SmartMileage folder in VS Code, then run in PowerShell:

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py

Open http://127.0.0.1:5000 in your browser.
SQLite trips.db is created automatically. Manual mode accepts a distance entered from any map app. Live GPS uses browser geolocation and Haversine distance with basic filtering. It is an estimate, may miss movement, and does not reliably run in the background. For mobile GPS, deploy behind trusted HTTPS (a plain LAN IP is generally not a secure context); the default server is localhost only. This is a single-user local prototype, without authentication. Do not expose it publicly without securing it. Fuel price 106 is an editable example, not a live price.

Enter the amount paid for fuel and the price per litre to calculate the purchased fuel quantity (amount paid divided by price). The mileage estimate assumes that quantity was consumed over the recorded trip.

The Live GPS map uses OpenStreetMap through Leaflet and does not need an API key. OpenStreetMap map data is © OpenStreetMap contributors. Its public tile server has a usage policy and is not intended for high-volume production traffic.

GPS trips filter inaccurate fixes, stationary drift, and unrealistic jumps. They show accuracy, speed, and duration; where supported, the browser screen wake lock is requested while tracking. End Trip stops GPS without clearing the route. Save Trip stores the GPS coordinates, duration, distance, fuel quantity, amount paid, and fuel price. Existing SQLite databases are migrated automatically.

## Render deployment

Use `pip install -r requirements.txt` as the build command and `gunicorn app:app --bind 0.0.0.0:$PORT` as the start command. Render HTTPS enables mobile browser GPS and screen-wake-lock support where available. To keep SQLite data across redeploys, attach a persistent disk mounted at `/var/data` and set `DATABASE_PATH=/var/data/trips.db`; without a persistent disk, the service filesystem may be reset.
