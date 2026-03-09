import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import {
  ApplyIncidentRoutePayload,
  ApplyIncidentRouteResponse,
  CongestionHeatmapResponse,
  IncidentResolvePreviewResponse,
  IncidentsResponse,
  PerformanceAnalyticsResponse,
  RerouteEventsResponse,
  SimulationStatus,
  VehicleOverviewResponse,
  VehiclesResponse
} from '../models/fleet.models';

@Injectable({
  providedIn: 'root'
})
export class FleetApiService {
  private readonly backendBaseUrl = this.buildBackendBaseUrl();
  private readonly baseUrl = `${this.backendBaseUrl}/api`;

  constructor(private readonly http: HttpClient) {}

  getVehicles(): Observable<VehiclesResponse> {
    return this.http.get<VehiclesResponse>(`${this.baseUrl}/vehicles`).pipe(this.withLogging('GET /vehicles'));
  }

  initMockVehicles(): Observable<{ message: string; count: number }> {
    return this.http
      .post<{ message: string; count: number }>(`${this.baseUrl}/vehicles/init-mock`, {})
      .pipe(this.withLogging('POST /vehicles/init-mock'));
  }

  startSimulation(): Observable<{ started: boolean; reason?: string }> {
    return this.http
      .post<{ started: boolean; reason?: string }>(`${this.baseUrl}/simulation/start`, {})
      .pipe(this.withLogging('POST /simulation/start'));
  }

  stopSimulation(): Observable<{ stopped: boolean }> {
    return this.http
      .post<{ stopped: boolean }>(`${this.baseUrl}/simulation/stop`, {})
      .pipe(this.withLogging('POST /simulation/stop'));
  }

  getSimulationStatus(): Observable<SimulationStatus> {
    return this.http
      .get<SimulationStatus>(`${this.baseUrl}/simulation/status`)
      .pipe(this.withLogging('GET /simulation/status'));
  }

  getIncidents(): Observable<IncidentsResponse> {
    return this.http.get<IncidentsResponse>(`${this.baseUrl}/incidents`).pipe(this.withLogging('GET /incidents'));
  }

  injectIncidentNearVehicle(vehicleId: string): Observable<unknown> {
    return this.http
      .post(`${this.baseUrl}/incidents/inject/${vehicleId}`, {})
      .pipe(this.withLogging('POST /incidents/inject/:vehicleId'));
  }

  injectIncidentForTransitVehicles(): Observable<{ affectedVehicleIds?: string[] }> {
    return this.http
      .post<{ affectedVehicleIds?: string[] }>(`${this.baseUrl}/incidents/inject-transit`, {})
      .pipe(this.withLogging('POST /incidents/inject-transit'));
  }

  resolveIncident(incidentId: string): Observable<unknown> {
    return this.http
      .patch(`${this.baseUrl}/incidents/${incidentId}/resolve`, {})
      .pipe(this.withLogging('PATCH /incidents/:incidentId/resolve'));
  }

  getIncidentResolvePreview(incidentId: string, vehicleId?: string): Observable<IncidentResolvePreviewResponse> {
    let params = new HttpParams();
    if (vehicleId) {
      params = params.set('vehicleId', vehicleId);
    }

    return this.http
      .get<IncidentResolvePreviewResponse>(`${this.baseUrl}/incidents/${incidentId}/resolve-preview`, { params })
      .pipe(this.withLogging('GET /incidents/:incidentId/resolve-preview'));
  }

  applyIncidentRoute(incidentId: string, payload: ApplyIncidentRoutePayload): Observable<ApplyIncidentRouteResponse> {
    return this.http
      .post<ApplyIncidentRouteResponse>(`${this.baseUrl}/incidents/${incidentId}/apply-route`, payload)
      .pipe(this.withLogging('POST /incidents/:incidentId/apply-route'));
  }

  getReroutes(): Observable<RerouteEventsResponse> {
    return this.http
      .get<RerouteEventsResponse>(`${this.baseUrl}/incidents/reroutes`)
      .pipe(this.withLogging('GET /incidents/reroutes'));
  }

  getCongestionHeatmap(): Observable<CongestionHeatmapResponse> {
    return this.http
      .get<CongestionHeatmapResponse>(`${this.baseUrl}/analytics/congestion-heatmap`)
      .pipe(this.withLogging('GET /analytics/congestion-heatmap'));
  }

  getAnalyticsSummary(): Observable<PerformanceAnalyticsResponse> {
    return this.http
      .get<PerformanceAnalyticsResponse>(`${this.baseUrl}/analytics/summary`)
      .pipe(this.withLogging('GET /analytics/summary'));
  }

  getVehicleOverview(vehicleId: string): Observable<VehicleOverviewResponse> {
    return this.http
      .get<VehicleOverviewResponse>(`${this.baseUrl}/vehicles/overview/${vehicleId}`)
      .pipe(this.withLogging('GET /vehicles/overview/:vehicleId'));
  }

  private buildBackendBaseUrl(): string {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    return `${protocol}://${host}:5000`;
  }

  private withLogging<T>(label: string) {
    return (source: Observable<T>) =>
      source.pipe(
        tap((response) => console.log(`[FleetApiService] ${label}`, response)),
        catchError((error) => {
          console.error(`[FleetApiService] ${label} error`, error);
          return throwError(() => error);
        })
      );
  }
}
