from flask import Flask, render_template, request, jsonify
import sqlite3, math
from pathlib import Path
app=Flask(__name__)
DB=Path(__file__).with_name('trips.db')
def connect():
    db=sqlite3.connect(DB); db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY, mode TEXT, distance REAL, litres REAL, price REAL, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    return db
@app.get('/')
def home(): return render_template('index.html')
@app.get('/api/trips')
def trips():
    with connect() as db: return jsonify([dict(r) for r in db.execute('SELECT * FROM trips ORDER BY id DESC')])
@app.post('/api/trips')
def save():
    try:
        d=request.get_json(); mode=d['mode']; values=[float(d[k]) for k in ('distance','litres','price')]
        if mode not in ('odo','gps','manual') or not all(math.isfinite(v) and v>=0 for v in values) or values[0]<=0: raise ValueError()
    except (ValueError,TypeError,KeyError): return jsonify(error='Invalid trip data'),400
    with connect() as db: db.execute('INSERT INTO trips(mode,distance,litres,price) VALUES(?,?,?,?)',(mode,*values))
    return jsonify(ok=True),201
if __name__=='__main__': app.run(host='127.0.0.1',port=5000)
