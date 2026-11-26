from contextlib import closing
import json
import math
import os
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DB = Path(os.environ.get('DATABASE_PATH', str(Path(__file__).with_name('trips.db'))))
MAX_ROUTE_POINTS = 50000


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    try:
        db.execute(
            '''CREATE TABLE IF NOT EXISTS trips (
                id INTEGER PRIMARY KEY,
                mode TEXT,
                distance REAL,
                litres REAL,
                price REAL,
                created TEXT DEFAULT CURRENT_TIMESTAMP,
                amount_paid REAL NOT NULL DEFAULT 0,
                duration_seconds REAL NOT NULL DEFAULT 0,
                route_json TEXT NOT NULL DEFAULT '[]'
            )'''
        )
        columns = {row['name'] for row in db.execute('PRAGMA table_info(trips)')}
        if {'amount_paid', 'duration_seconds', 'route_json'} - columns:
            db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(trips)')}
            if 'amount_paid' not in columns:
                db.execute('ALTER TABLE trips ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0')
                db.execute('UPDATE trips SET amount_paid = litres * price')
            if 'duration_seconds' not in columns:
                db.execute('ALTER TABLE trips ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 0')
            if 'route_json' not in columns:
                db.execute("ALTER TABLE trips ADD COLUMN route_json TEXT NOT NULL DEFAULT '[]'")
    except Exception:
        db.close()
        raise
    return db


def normalize_route(raw_route):
    if not isinstance(raw_route, list) or len(raw_route) > MAX_ROUTE_POINTS:
        raise ValueError('Invalid route')

    route = []
    for point in raw_route:
        if not isinstance(point, dict):
            raise ValueError('Invalid route point')
        lat = float(point['lat'])
        lon = float(point['lon'])
        timestamp = float(point.get('t', point.get('timestamp', 0)))
        accuracy = float(point.get('accuracy', 0))
        speed = float(point.get('speed', 0))
        values = (lat, lon, timestamp, accuracy, speed)
        if (
            not all(math.isfinite(value) for value in values)
            or not -90 <= lat <= 90
            or not -180 <= lon <= 180
            or timestamp < 0
            or accuracy < 0
            or speed < 0
        ):
            raise ValueError('Invalid route point')
        route.append({
            'lat': lat,
            'lon': lon,
            't': timestamp,
            'accuracy': accuracy,
            'speed': speed,
        })
    return route


@app.get('/')
def home():
    return render_template('index.html')


@app.get('/api/trips')
def trips():
    with closing(connect()) as db, db:
        saved = []
        for row in db.execute('SELECT * FROM trips ORDER BY id DESC'):
            trip = dict(row)
            trip['route'] = json.loads(trip.pop('route_json'))
            saved.append(trip)
    return jsonify(saved)


@app.post('/api/trips')
def save():
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('Expected an object')

        mode = data['mode']
        distance = float(data['distance'])
        price = float(data['price'])
        if 'amount_paid' in data:
            amount_paid = float(data['amount_paid'])
            if price <= 0:
                raise ValueError('Fuel price must be greater than zero')
            litres = amount_paid / price
        else:
            litres = float(data['litres'])
            amount_paid = litres * price

        duration_seconds = float(data.get('duration_seconds', 0))
        route = normalize_route(data.get('route', []))
        values = (distance, litres, price, amount_paid, duration_seconds)
        if (
            mode not in ('odo', 'gps', 'manual')
            or not all(math.isfinite(value) and value >= 0 for value in values)
            or distance <= 0
        ):
            raise ValueError('Invalid trip data')
        if mode != 'gps':
            duration_seconds = 0
            route = []
    except (ValueError, TypeError, KeyError, OverflowError):
        return jsonify(error='Invalid trip data'), 400

    with closing(connect()) as db, db:
        db.execute(
            '''INSERT INTO trips
                (mode, distance, litres, price, amount_paid, duration_seconds, route_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (
                mode,
                distance,
                litres,
                price,
                amount_paid,
                duration_seconds,
                json.dumps(route, separators=(',', ':')),
            ),
        )
    return jsonify(ok=True), 201


if __name__ == '__main__':
    app.run(
        host=os.environ.get('HOST', '127.0.0.1'),
        port=int(os.environ.get('PORT', '5000')),
    )
