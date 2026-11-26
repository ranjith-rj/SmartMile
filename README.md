# Smart Mileage Tracker
Extract the ZIP, open the SmartMileage folder in VS Code, then run in PowerShell:

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py

Open http://127.0.0.1:5000 in your browser.
SQLite trips.db is created automatically. Manual mode accepts a distance from Google Maps; no paid API is integrated. Live GPS uses browser geolocation and Haversine distance with basic filtering. It is an estimate, may miss movement, and does not reliably run in the background. For mobile GPS, deploy behind trusted HTTPS (a plain LAN IP is generally not a secure context); the default server is localhost only. This is a single-user local prototype, without authentication. Do not expose it publicly without securing it. Fuel price 106 is an editable example, not a live price.

Enter the amount paid for fuel and the price per litre to calculate the purchased fuel quantity (amount paid divided by price). The mileage estimate assumes that quantity was consumed over the recorded trip.
