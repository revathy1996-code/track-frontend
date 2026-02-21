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
  lastUpdated: string;
}

export interface VehiclesResponse {
  data: Vehicle[];
}

export interface SimulationStatus {
  isRunning: boolean;
  activeVehicles: number;
}
