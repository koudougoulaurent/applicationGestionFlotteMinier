import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Circle, useMap } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { gpsApi } from '../lib/api';
import { useRealtimeStore } from '../store';
import { GpsPosition, Location } from '../types';
import { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MINE_CENTER: LatLngExpression = [-12.5, 27.855];

const CATEGORY_COLORS: Record<string, string> = {
  TRUCK:      '#f59e0b',
  EXCAVATOR:  '#ef4444',
  LOADER:     '#8b5cf6',
  DOZER:      '#06b6d4',
  DRILL:      '#f97316',
  GRADER:     '#10b981',
  WATER_TRUCK:'#3b82f6',
  SERVICE:    '#64748b',
};

const LOCATION_COLORS: Record<string, { color: string; fillColor: string }> = {
  PIT:          { color: '#ef4444', fillColor: '#ef444420' },
  DUMP:         { color: '#78716c', fillColor: '#78716c20' },
  STOCKPILE:    { color: '#f59e0b', fillColor: '#f59e0b20' },
  CRUSHER:      { color: '#8b5cf6', fillColor: '#8b5cf620' },
  FUEL_STATION: { color: '#22c55e', fillColor: '#22c55e20' },
  WORKSHOP:     { color: '#3b82f6', fillColor: '#3b82f620' },
  PARKING:      { color: '#64748b', fillColor: '#64748b20' },
};

function MapController() {
  const map = useMap();
  useEffect(() => {
    map.setView(MINE_CENTER, 14);
  }, [map]);
  return null;
}

export default function MineMap() {
  const { positions } = useRealtimeStore();
  const mapRef = useRef(null);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => { const r = await gpsApi.locations(); return r.data; },
  });

  const { data: initialPositions = [] } = useQuery<GpsPosition[]>({
    queryKey: ['gps-positions'],
    queryFn: async () => { const r = await gpsApi.positions(); return r.data; },
    refetchInterval: 30_000,
  });

  // Merge static query with realtime store
  const allPositions: GpsPosition[] = Object.keys(positions).length > 0
    ? Object.values(positions)
    : initialPositions;

  const byCategory = allPositions.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      {/* Legend bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(byCategory).map(([cat, count]) => (
          <div key={cat} className="flex items-center gap-1.5 text-xs">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] || '#888' }}></span>
            <span className="text-mine-muted">{cat}</span>
            <span className="font-bold font-mono">{count}</span>
          </div>
        ))}
        <div className="ml-auto text-xs text-mine-muted">
          {allPositions.length} équipements trackés
        </div>
      </div>

      {/* Map */}
      <div className="rounded-xl overflow-hidden border border-mine-border" style={{ height: 'calc(100vh - 220px)' }}>
        <MapContainer
          ref={mapRef}
          center={MINE_CENTER}
          zoom={14}
          style={{ height: '100%', width: '100%', background: '#0a0d14' }}
        >
          <MapController />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='© OpenStreetMap © CARTO'
          />

          {/* Zones */}
          {locations.map((loc) => {
            const style = LOCATION_COLORS[loc.location_type] || { color: '#888', fillColor: '#88888820' };
            return (
              <Circle
                key={loc.location_id}
                center={[loc.latitude, loc.longitude] as LatLngExpression}
                radius={loc.radius_m || 100}
                pathOptions={{
                  color: style.color,
                  fillColor: style.fillColor,
                  fillOpacity: 0.4,
                  weight: 2,
                  dashArray: loc.location_type === 'PIT' ? '5,5' : undefined,
                }}
              >
                <Popup>
                  <div style={{ color: '#000', minWidth: 120 }}>
                    <strong>{loc.name}</strong><br />
                    <span style={{ color: '#666' }}>{loc.location_type}</span><br />
                    <span style={{ fontSize: 11 }}>{Number(loc.latitude).toFixed(5)}, {Number(loc.longitude).toFixed(5)}</span>
                  </div>
                </Popup>
              </Circle>
            );
          })}

          {/* Equipment markers */}
          {allPositions.map((eq) => {
            const color = CATEGORY_COLORS[eq.category] || '#888';
            const isMoving = eq.speed_kmh > 3;
            return (
              <CircleMarker
                key={eq.equipment_id}
                center={[eq.latitude, eq.longitude] as LatLngExpression}
                radius={isMoving ? 9 : 7}
                pathOptions={{
                  color: '#0a0d14',
                  fillColor: color,
                  fillOpacity: 0.95,
                  weight: 2,
                }}
              >
                <Popup>
                  <div style={{ color: '#000', minWidth: 160 }}>
                    <strong style={{ fontSize: 14 }}>{eq.fleet_number}</strong>
                    <br />
                    <span style={{ color: '#333' }}>{eq.category}</span>
                    <br />
                    <div style={{ marginTop: 4 }}>
                      <span style={{
                        backgroundColor: eq.status_color || color,
                        color: '#000',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}>
                        {eq.status}
                      </span>
                    </div>
                    {eq.operator_name && (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#555' }}>
                        👷 {eq.operator_name}
                      </div>
                    )}
                    {eq.speed_kmh > 0 && (
                      <div style={{ fontSize: 11, color: '#555' }}>
                        🏎 {Math.round(eq.speed_kmh)} km/h · {Math.round(eq.heading)}°
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Location legend */}
      <div className="flex gap-4 flex-wrap text-xs">
        {Object.entries(LOCATION_COLORS).map(([type, style]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded" style={{ backgroundColor: style.color }}></span>
            <span className="text-mine-muted">{type.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
