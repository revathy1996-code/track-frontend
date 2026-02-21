import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { SimulationStatus, Vehicle } from '../models/fleet.models';

@Injectable({
  providedIn: 'root'
})
export class FleetLiveService {
  private socket?: Socket;
  private readonly statusSubject = new Subject<SimulationStatus>();
  private readonly updateSubject = new Subject<Vehicle[]>();

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }

    this.socket = io('http://localhost:5000', {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('[FleetLiveService] socket connected');
    });

    this.socket.on('simulation:status', (status: SimulationStatus) => {
      this.statusSubject.next(status);
    });

    this.socket.on('simulation:update', (vehicles: Vehicle[]) => {
      this.updateSubject.next(vehicles);
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
}
