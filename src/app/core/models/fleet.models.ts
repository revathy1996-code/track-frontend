export type VehicleStatus = 'idle' | 'moving' | 'reached';

export interface LocationPoint {
  lat: number;
  lng: number;
}

export interface Vehicle {
  _id?: string;
  vehicleId: string;
  name: string;
  source: LocationPoint;
  destination: LocationPoint;
  currentLocation: LocationPoint;
  status: VehicleStatus;
  speedKmh: number;
  rerouteCount?: number;
  totalDelayMinutes?: number;
  lastUpdated: string;
}

export interface VehiclesResponse {
  data: Vehicle[];
}

export interface SimulationStatus {
  isRunning: boolean;
  activeVehicles: number;
}

export interface Incident {
  incidentId: string;
  type: 'block' | 'accident' | 'congestion';
  severity: number;
  reason: string;
  location: LocationPoint;
  radiusMeters: number;
  status: 'active' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface IncidentsResponse {
  data: Incident[];
}

export interface IncidentResolvePreview {
  incident: Incident;
  vehicle: Vehicle;
  currentRoutePoints: LocationPoint[];
  alternateRoutePoints: LocationPoint[];
  proposedDestination: LocationPoint;
  heatmapPoints: HeatmapPoint[];
}

export interface IncidentResolvePreviewResponse {
  data: IncidentResolvePreview;
}

export interface ApplyIncidentRoutePayload {
  vehicleId: string;
  routePoints: LocationPoint[];
  destination: LocationPoint;
}

export interface ApplyIncidentRouteResponse {
  data: {
    incident: Incident;
    vehicle: Vehicle;
    routePoints: LocationPoint[];
    destination: LocationPoint;
  };
}

export interface RerouteEvent {
  vehicleId: string;
  timestamp: string;
  reason: string;
  blockedAt: LocationPoint;
  oldEtaMinutes: number;
  newEtaMinutes: number;
}

export interface RerouteEventsResponse {
  data: RerouteEvent[];
}

export interface HeatmapPoint {
  vehicleId: string;
  lat: number;
  lng: number;
  intensity: number;
  speedKmh: number;
  congestionLevel: 'low' | 'medium' | 'high';
}

export interface CongestionHeatmapResponse {
  generatedAt: string;
  points: HeatmapPoint[];
}

export interface AnalyticsSummary {
  totalVehicles: number;
  totalTrips: number;
  completedTrips: number;
  onTimeDeliveryPct: number;
  avgDelayMinutes: number;
  avgReroutesPerTrip: number;
  avgRouteEfficiency: number;
  fuelProxyScore: number;
}

export interface VehicleAnalytics {
  vehicleId: string;
  status: VehicleStatus;
  rerouteCount: number;
  totalDelayMinutes: number;
  speedKmh: number;
}

export interface PerformanceAnalyticsResponse {
  summary: AnalyticsSummary;
  vehicleBreakdown: VehicleAnalytics[];
  recentReroutes: RerouteEvent[];
}
