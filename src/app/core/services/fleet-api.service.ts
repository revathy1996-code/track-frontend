import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { SimulationStatus, VehiclesResponse } from '../models/fleet.models';

@Injectable({
  providedIn: 'root'
})
export class FleetApiService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getVehicles(): Observable<VehiclesResponse> {
    const url = `${this.baseUrl}/vehicles`;
    console.log('[FleetApiService] GET', url);
    return this.http.get<VehiclesResponse>(url).pipe(
      tap((response) => console.log('[FleetApiService] GET /vehicles response:', response)),
      catchError((error) => {
        console.error('[FleetApiService] GET /vehicles error:', error);
        return throwError(() => error);
      })
    );
  }

  initMockVehicles(): Observable<{ message: string; count: number }> {
    const url = `${this.baseUrl}/vehicles/init-mock`;
    console.log('[FleetApiService] POST', url);
    return this.http.post<{ message: string; count: number }>(url, {}).pipe(
      tap((response) => console.log('[FleetApiService] POST /vehicles/init-mock response:', response)),
      catchError((error) => {
        console.error('[FleetApiService] POST /vehicles/init-mock error:', error);
        return throwError(() => error);
      })
    );
  }

  startSimulation(): Observable<{ started: boolean; reason?: string }> {
    const url = `${this.baseUrl}/simulation/start`;
    console.log('[FleetApiService] POST', url);
    return this.http.post<{ started: boolean; reason?: string }>(url, {}).pipe(
      tap((response) => console.log('[FleetApiService] POST /simulation/start response:', response)),
      catchError((error) => {
        console.error('[FleetApiService] POST /simulation/start error:', error);
        return throwError(() => error);
      })
    );
  }

  stopSimulation(): Observable<{ stopped: boolean }> {
    const url = `${this.baseUrl}/simulation/stop`;
    console.log('[FleetApiService] POST', url);
    return this.http.post<{ stopped: boolean }>(url, {}).pipe(
      tap((response) => console.log('[FleetApiService] POST /simulation/stop response:', response)),
      catchError((error) => {
        console.error('[FleetApiService] POST /simulation/stop error:', error);
        return throwError(() => error);
      })
    );
  }

  getSimulationStatus(): Observable<SimulationStatus> {
    const url = `${this.baseUrl}/simulation/status`;
    console.log('[FleetApiService] GET', url);
    return this.http.get<SimulationStatus>(url).pipe(
      tap((response) => console.log('[FleetApiService] GET /simulation/status response:', response)),
      catchError((error) => {
        console.error('[FleetApiService] GET /simulation/status error:', error);
        return throwError(() => error);
      })
    );
  }
}
