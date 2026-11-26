const $ = id => document.getElementById(id);
const MAX_ACCURACY_METERS = 40;
const MIN_MOVEMENT_KM = 0.008;
const MAX_DRIFT_THRESHOLD_KM = 0.02;
const MAX_SPEED_KMH = 200;

let mode = 'odo';
let km = 0;
let watch = null;
let points = [];
let timer = null;
let startTime = null;
let tripDurationSeconds = 0;
let wakeLock = null;
let osmMap = null;
let osmMarker = null;
let osmRoute = null;

const num = id => $(id).value.trim() === '' ? NaN : Number($(id).value);

function distance() {
  if (mode === 'gps') return km;
  if (mode === 'manual') return num('manualkm');
  return num('end') - num('start');
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}h ${minutes}m ${remainder}s`
    : `${minutes}m ${remainder}s`;
}

function updateElapsed() {
  $('elapsed').textContent = formatDuration(tripDurationSeconds);
}

function update() {
  const tripDistance = distance();
  const amount = num('paid');
  const price = num('price');
  const validDistance = Number.isFinite(tripDistance) && tripDistance >= 0;
  const litres = Number.isFinite(amount) && amount >= 0
    && Number.isFinite(price) && price > 0
    ? amount / price
    : NaN;
  const validAmount = Number.isFinite(amount) && amount >= 0;

  $('distance').textContent = `${validDistance ? tripDistance.toFixed(2) : '—'} km`;
  $('mileage').textContent = validDistance && Number.isFinite(litres) && litres > 0
    ? (tripDistance / litres).toFixed(2)
    : '—';
  $('cost').textContent = validAmount ? `₹${amount.toFixed(2)}` : '—';
  $('perkm').textContent = validDistance && tripDistance > 0 && validAmount
    ? `₹${(amount / tripDistance).toFixed(2)}`
    : '—';
  $('used').textContent = Number.isFinite(litres) ? `${litres.toFixed(3)} L` : '—';
}

function resizeMap() {
  requestAnimationFrame(() => {
    if (!osmMap) return;
    osmMap.invalidateSize();
    if (points.length) {
      const current = points[points.length - 1];
      osmMap.panTo([current.lat, current.lon]);
    }
  });
}

function haversine(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const deltaLat = (b.lat - a.lat) * radians;
  const deltaLon = (b.lon - a.lon) * radians;
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

function updateGpsReadouts(accuracy, speed) {
  $('gpsAccuracy').textContent = Number.isFinite(accuracy)
    ? `±${Math.round(accuracy)} m`
    : '—';
  $('gpsSpeed').textContent = Number.isFinite(speed)
    ? `${speed.toFixed(1)} km/h`
    : '—';
}

function drawRoute() {
  const path = points.map(point => [point.lat, point.lon]);
  if (osmRoute) osmRoute.setLatLngs(path);
  if (!path.length || !osmMap) return;

  const current = path[path.length - 1];
  if (!osmMarker) {
    osmMarker = L.marker(current).addTo(osmMap);
  } else {
    osmMarker.setLatLng(current);
  }
  osmMap.panTo(current);
}

function initializeMap() {
  if (!window.L) {
    $('mapNotice').textContent = 'Could not load the free map library. Check your internet connection and reload.';
    return;
  }

  osmMap = L.map('route').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(osmMap);
  osmRoute = L.polyline([], { color: '#70a8ff', weight: 4 }).addTo(osmMap);
}

function clearRoute() {
  if (osmRoute) osmRoute.setLatLngs([]);
  if (osmMarker) {
    osmMap.removeLayer(osmMarker);
    osmMarker = null;
  }
}

async function requestWakeLock() {
  if (!navigator.wakeLock) return;

  try {
    const lock = await navigator.wakeLock.request('screen');
    if (watch === null) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch (error) {
    if (watch !== null) {
      $('msg').textContent = `Screen wake lock unavailable: ${error.message}`;
    }
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  const lock = wakeLock;
  wakeLock = null;
  lock.release().catch(error => {
    $('msg').textContent = `Could not release screen wake lock: ${error.message}`;
  });
}

function stopTracking() {
  if (watch !== null) {
    navigator.geolocation.clearWatch(watch);
    watch = null;
  }
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (startTime !== null) {
    tripDurationSeconds = Math.floor((Date.now() - startTime) / 1000);
    updateElapsed();
  }
  releaseWakeLock();
  $('go').disabled = false;
  $('stop').disabled = true;
  $('status').textContent = `Trip ended · ${points.length} GPS points · ${formatDuration(tripDurationSeconds)} · select Save Trip to store`;
}

function rejectGpsReading(message, accuracy = NaN, speed = NaN) {
  updateGpsReadouts(accuracy, speed);
  $('status').textContent = message;
}

function acceptGpsPosition(position) {
  if (watch === null) return;

  const coords = position.coords;
  const accuracy = coords.accuracy;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS) {
    rejectGpsReading(
      'Waiting for an accurate GPS fix…',
      accuracy,
    );
    return;
  }

  if (
    !Number.isFinite(coords.latitude)
    || !Number.isFinite(coords.longitude)
    || coords.latitude < -90
    || coords.latitude > 90
    || coords.longitude < -180
    || coords.longitude > 180
    || !Number.isFinite(position.timestamp)
  ) {
    rejectGpsReading('Ignoring an invalid GPS coordinate.', accuracy);
    return;
  }

  const point = {
    lat: coords.latitude,
    lon: coords.longitude,
    t: position.timestamp,
    accuracy,
    speed: Number.isFinite(coords.speed) && coords.speed >= 0
      ? coords.speed * 3.6
      : 0,
  };
  if (point.speed > MAX_SPEED_KMH) {
    rejectGpsReading('Ignoring an unrealistic GPS speed.', accuracy);
    return;
  }

  let segmentDistance = 0;
  let segmentSpeed = point.speed;
  if (points.length) {
    const previous = points[points.length - 1];
    const elapsedSeconds = (point.t - previous.t) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      rejectGpsReading('Ignoring a GPS reading with an invalid timestamp.', accuracy);
      return;
    }

    segmentDistance = haversine(previous, point);
    segmentSpeed = segmentDistance / (elapsedSeconds / 3600);
    if (!Number.isFinite(segmentSpeed) || segmentSpeed > MAX_SPEED_KMH) {
      rejectGpsReading('Ignoring an unrealistic GPS location jump.', accuracy);
      return;
    }

    const driftThreshold = Math.max(
      MIN_MOVEMENT_KM,
      Math.min(MAX_DRIFT_THRESHOLD_KM, (accuracy + previous.accuracy) / 2000),
    );
    if (segmentDistance < driftThreshold) {
      updateGpsReadouts(accuracy, point.speed || 0);
      $('status').textContent = 'Tracking · stationary GPS drift filtered';
      return;
    }

    if (point.speed === 0) point.speed = segmentSpeed;
    km += segmentDistance;
  }

  points.push(point);
  updateGpsReadouts(accuracy, segmentSpeed);
  $('status').textContent = `Tracking · GPS fix ±${Math.round(accuracy)} m`;
  drawRoute();
  update();
}

document.querySelectorAll('input').forEach(input => {
  input.oninput = update;
});

document.querySelectorAll('[data-mode]').forEach(button => {
  button.onclick = () => {
    if (watch !== null) {
      $('msg').textContent = 'End the GPS trip before changing mode.';
      return;
    }
    mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    ['odo', 'gps', 'manual'].forEach(id => {
      $(id).hidden = id !== mode;
    });
    if (mode === 'gps') resizeMap();
    $('msg').textContent = '';
    update();
  };
});

$('go').onclick = () => {
  if (!navigator.geolocation || !window.isSecureContext) {
    $('status').textContent = 'GPS requires HTTPS or localhost and location permission.';
    return;
  }

  km = 0;
  points = [];
  tripDurationSeconds = 0;
  startTime = Date.now();
  clearRoute();
  updateElapsed();
  updateGpsReadouts(NaN, NaN);
  $('msg').textContent = '';
  $('go').disabled = true;
  $('stop').disabled = false;
  $('status').textContent = 'Waiting for GPS…';
  requestWakeLock();

  try {
    watch = navigator.geolocation.watchPosition(
      acceptGpsPosition,
      error => {
        if (watch === null) return;
        stopTracking();
        $('status').textContent = `GPS error: ${error.message}`;
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  } catch (error) {
    stopTracking();
    $('status').textContent = `Could not start GPS: ${error.message}`;
    return;
  }

  timer = setInterval(() => {
    if (watch === null || startTime === null) return;
    tripDurationSeconds = Math.floor((Date.now() - startTime) / 1000);
    updateElapsed();
  }, 1000);
};

$('stop').onclick = stopTracking;

async function history() {
  try {
    const response = await fetch('/api/trips');
    if (!response.ok) throw Error(`Trip history request failed (${response.status})`);
    const rows = await response.json();
    $('history').replaceChildren();
    if (!rows.length) $('history').textContent = 'No trips saved yet.';
    for (const trip of rows) {
      const item = document.createElement('div');
      item.className = 'trip';
      const duration = trip.mode === 'gps'
        ? ` · ${formatDuration(trip.duration_seconds)}`
        : '';
      item.textContent = `${trip.distance.toFixed(2)} km · ₹${trip.amount_paid.toFixed(2)} · ${trip.mode.toUpperCase()} · ${trip.litres.toFixed(3)} L${duration} · ${trip.created} UTC`;
      $('history').append(item);
    }
  } catch (error) {
    $('history').textContent = `Could not load history: ${error.message}`;
  }
}

$('save').onclick = async () => {
  const tripDistance = distance();
  const amount = num('paid');
  const price = num('price');
  const litres = amount / price;
  if (
    watch !== null
    || !Number.isFinite(tripDistance)
    || tripDistance <= 0
    || !Number.isFinite(amount)
    || amount < 0
    || !Number.isFinite(price)
    || price <= 0
    || !Number.isFinite(litres)
  ) {
    $('msg').textContent = 'End tracking and enter a valid distance, amount paid, and fuel price greater than zero.';
    return;
  }

  try {
    $('save').disabled = true;
    const response = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        distance: tripDistance,
        litres,
        price,
        amount_paid: amount,
        duration_seconds: mode === 'gps' ? tripDurationSeconds : 0,
        route: mode === 'gps' ? points : [],
      }),
    });
    if (!response.ok) throw Error(`Trip save failed (${response.status})`);
    $('msg').textContent = 'Trip saved.';
    await history();
  } catch (error) {
    $('msg').textContent = `Could not save trip: ${error.message}`;
  } finally {
    $('save').disabled = false;
  }
};

$('reset').onclick = () => {
  stopTracking();
  km = 0;
  points = [];
  startTime = null;
  tripDurationSeconds = 0;
  clearRoute();
  ['start', 'end', 'manualkm', 'paid'].forEach(id => {
    $(id).value = '';
  });
  $('elapsed').textContent = 'Ready for your trip';
  $('gpsAccuracy').textContent = '—';
  $('gpsSpeed').textContent = '—';
  $('status').textContent = 'GPS not started';
  $('msg').textContent = '';
  update();
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && watch !== null && !wakeLock) {
    requestWakeLock();
  }
});

initializeMap();
drawRoute();
update();
history();
