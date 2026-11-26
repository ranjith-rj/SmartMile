import sqlite3
import tempfile
import unittest
from pathlib import Path

import app as mileage_app


class TripStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db = mileage_app.DB
        mileage_app.DB = Path(self.temp_dir.name) / 'trips.db'
        self.client = mileage_app.app.test_client()

    def tearDown(self):
        mileage_app.DB = self.original_db
        self.temp_dir.cleanup()

    def test_migrates_existing_trips_and_saves_gps_route(self):
        db = sqlite3.connect(mileage_app.DB)
        db.execute(
            '''CREATE TABLE trips (
                id INTEGER PRIMARY KEY,
                mode TEXT,
                distance REAL,
                litres REAL,
                price REAL,
                created TEXT DEFAULT CURRENT_TIMESTAMP
            )'''
        )
        db.execute(
            'INSERT INTO trips(mode, distance, litres, price) VALUES (?, ?, ?, ?)',
            ('odo', 25, 2.5, 100),
        )
        db.commit()
        db.close()

        migrated = self.client.get('/api/trips').get_json()
        self.assertEqual(migrated[0]['amount_paid'], 250)
        self.assertEqual(migrated[0]['duration_seconds'], 0)
        self.assertEqual(migrated[0]['route'], [])

        response = self.client.post('/api/trips', json={
            'mode': 'gps',
            'distance': 5.2,
            'price': 106,
            'amount_paid': 212,
            'duration_seconds': 90,
            'route': [
                {'lat': 43.6532, 'lon': -79.3832, 't': 1000, 'accuracy': 8, 'speed': 0},
                {'lat': 43.654, 'lon': -79.382, 't': 2000, 'accuracy': 7, 'speed': 4.5},
            ],
        })
        self.assertEqual(response.status_code, 201)

        saved = self.client.get('/api/trips').get_json()[0]
        self.assertEqual(saved['litres'], 2)
        self.assertEqual(saved['amount_paid'], 212)
        self.assertEqual(saved['duration_seconds'], 90)
        self.assertEqual(len(saved['route']), 2)
        self.assertEqual(saved['route'][1]['lat'], 43.654)

    def test_rejects_invalid_gps_coordinates(self):
        response = self.client.post('/api/trips', json={
            'mode': 'gps',
            'distance': 1,
            'price': 100,
            'amount_paid': 100,
            'duration_seconds': 10,
            'route': [{'lat': 91, 'lon': 0}],
        })
        self.assertEqual(response.status_code, 400)

    def test_accepts_existing_manual_trip_payload(self):
        response = self.client.post('/api/trips', json={
            'mode': 'manual',
            'distance': 10,
            'litres': 1.5,
            'price': 100,
        })
        self.assertEqual(response.status_code, 201)

        saved = self.client.get('/api/trips').get_json()[0]
        self.assertEqual(saved['amount_paid'], 150)
        self.assertEqual(saved['duration_seconds'], 0)
        self.assertEqual(saved['route'], [])


if __name__ == '__main__':
    unittest.main()
