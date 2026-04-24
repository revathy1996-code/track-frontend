import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { GeofenceBreach, Incident, RerouteEvent, SimulationStatus, Vehicle } from '../models/fleet.models';

@Injectable({
  providedIn: 'root'
})
export class FleetLiveService {
  private socket?: Socket;
  private readonly socketUrl = this.buildSocketUrl();
  private readonly statusSubject = new Subject<SimulationStatus>();
  private readonly updateSubject = new Subject<Vehicle[]>();
  private readonly incidentsSubject = new Subject<Incident[]>();
  private readonly rerouteSubject = new Subject<RerouteEvent>();
  private readonly rerouteHistorySubject = new Subject<RerouteEvent[]>();
  private readonly geofenceBreachSubject = new Subject<GeofenceBreach>();
  private readonly geofenceClearSubject = new Subject<string>();

  constructor(private readonly ngZone: NgZone) {}

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }

    this.socket = io(this.socketUrl, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('[FleetLiveService] socket connected');
    });

    this.socket.on('simulation:status', (status: SimulationStatus) => {
      this.ngZone.run(() => this.statusSubject.next(status));
    });

    this.socket.on('simulation:update', (vehicles: Vehicle[]) => {
      this.ngZone.run(() => this.updateSubject.next(vehicles));
    });

    this.socket.on('incidents:update', (incidents: Incident[]) => {
      this.ngZone.run(() => this.incidentsSubject.next(incidents));
    });

    this.socket.on('simulation:reroute', (event: RerouteEvent) => {
      this.ngZone.run(() => this.rerouteSubject.next(event));
    });

    this.socket.on('simulation:reroute:history', (events: RerouteEvent[]) => {
      this.ngZone.run(() => this.rerouteHistorySubject.next(events));
    });

    this.socket.on('geofence:breach', (breach: GeofenceBreach) => {
      this.ngZone.run(() => this.geofenceBreachSubject.next(breach));
    });

    this.socket.on('geofence:breach:clear', (payload: { vehicleId: string }) => {
      this.ngZone.run(() => this.geofenceClearSubject.next(payload.vehicleId));
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('[FleetLiveService] socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('[FleetLiveService] socket connect error:', error.message);
    });
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = undefined;
  }

  simulationStatus$(): Observable<SimulationStatus> {
    return this.statusSubject.asObservable();
  }

  simulationUpdates$(): Observable<Vehicle[]> {
    return this.updateSubject.asObservable();
  }

  incidents$(): Observable<Incident[]> {
    return this.incidentsSubject.asObservable();
  }

  reroutes$(): Observable<RerouteEvent> {
    return this.rerouteSubject.asObservable();
  }

  rerouteHistory$(): Observable<RerouteEvent[]> {
    return this.rerouteHistorySubject.asObservable();
  }

  geofenceBreaches$(): Observable<GeofenceBreach> {
    return this.geofenceBreachSubject.asObservable();
  }

  geofenceClears$(): Observable<string> {
    return this.geofenceClearSubject.asObservable();
  }

  private buildSocketUrl(): string {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    return `${protocol}://${host}:5000`;
  }
}
