import { AfterViewInit, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, Subscription, switchMap, timeout } from 'rxjs';
import { FleetApiService } from '../../core/services/fleet-api.service';
import { FleetLiveService } from '../../core/services/fleet-live.service';
import {
  ApplyIncidentRoutePayload,
  HeatmapPoint,
  Incident,
  IncidentResolvePreview,
  RerouteEvent,
  Vehicle
} from '../../core/models/fleet.models';

declare const L: any;

@Component({
  selector: 'app-fleet-management',
  templateUrl: './fleet-management.component.html',
  standalone: false
})
export class FleetManagementComponent implements OnInit, AfterViewInit, OnDestroy {
  vehicles: Vehicle[] = [];
  incidents: Incident[] = [];
  rerouteEvents: RerouteEvent[] = [];
  heatmapPoints: HeatmapPoint[] = [];
  isSimulationRunning = false;
  isInitializing = false;
  isStarting = false;
  isStopping = false;
  isInjectingIncident = false;
  isResettingFresh = false;
  message = '';
  errorMessage = '';
  selectedVehicleId: string | null = null;
  isLoadingSelectedRoute = false;
  isResolveModalOpen = false;
  isLoadingResolvePreview = false;
  isApplyingRoute = false;
  isAlternateRouteSelected = false;
  resolveModalError = '';
  resolveModalIncident?: Incident;
  resolvePreview?: IncidentResolvePreview;

  private map?: any;
  private markers = new Map<string, any>();
  private sourceMarkers = new Map<string, any>();
  private destinationMarkers = new Map<string, any>();
  private routeLines = new Map<string, any>();
  private incidentMarkers = new Map<string, any>();
  private incidentRadiusLayers = new Map<string, any>();
  private heatLayers = new Map<string, any>();
  private selectedRouteLine?: any;
  private selectedRoutePoints = new Map<string, Array<[number, number]>>();
  private routeZoomedVehicleId: string | null = null;
  private statusSub?: Subscription;
  private updateSub?: Subscription;
  private incidentsSub?: Subscription;
  private rerouteSub?: Subscription;
  private rerouteHistorySub?: Subscription;
  private heatmapIntervalId?: number;
  private heatmapRefreshTimerId?: number;
  private heatmapRefreshQueued = false;
  private heatmapRequestInFlight = false;
  private lastHeatmapRefreshAt = 0;
  private readonly heatmapRefreshThrottleMs = 2500;
  private resolveMap?: any;
  private resolveTileLayer?: any;
  private resolveCurrentRouteLayer?: any;
  private resolveAlternateRouteLayer?: any;
  private resolveAlternateRouteHitLayer?: any;
  private resolveSourceMarker?: any;
  private resolveDestinationMarker?: any;
  private resolveVehicleMarker?: any;
  private resolveIncidentMarker?: any;
  private resolveHeatLayers: any[] = [];
  private resolveMapRenderTimer?: number;

  constructor(
    private readonly fleetApi: FleetApiService,
    private readonly fleetLive: FleetLiveService,
    private readonly ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.loadVehicles();
    this.loadSimulationStatus();
    this.loadIncidents();
    this.loadReroutes();
    this.initLiveUpdates();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
    this.updateSub?.unsubscribe();
    this.incidentsSub?.unsubscribe();
    this.rerouteSub?.unsubscribe();
    this.rerouteHistorySub?.unsubscribe();
    if (this.heatmapIntervalId) {
      window.clearInterval(this.heatmapIntervalId);
    }
    if (this.heatmapRefreshTimerId) {
      window.clearTimeout(this.heatmapRefreshTimerId);
      this.heatmapRefreshTimerId = undefined;
    }
    this.fleetLive.disconnect();
    if (this.map) {
      this.map.remove();
    }
    if (this.resolveMap) {
      this.resolveMap.remove();
      this.resolveMap = undefined;
    }
    if (this.resolveMapRenderTimer) {
      window.clearTimeout(this.resolveMapRenderTimer);
      this.resolveMapRenderTimer = undefined;
    }
  }

  initMockVehicles(): void {
    if (this.isInitializing || this.isStarting || this.isStopping || this.isResettingFresh) {
      return;
    }
    this.isInitializing = true;
    this.clearMessages();
    this.fleetApi
      .initMockVehicles()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isInitializing = false;
        })
      )
      .subscribe({
      next: (response) => {
        this.message = `${response.count} mock vehicles initialized.`;
        this.isSimulationRunning = false;
        this.selectedVehicleId = null;
        this.routeZoomedVehicleId = null;
        this.selectedRoutePoints.clear();
        this.loadVehicles();
        this.loadSimulationStatus();
        this.loadIncidents();
        this.loadReroutes();
        this.refreshHeatmap();
      },
      error: (error: unknown) => {
        this.errorMessage =
          this.isTimeoutError(error)
            ? 'Initialize request timed out. Check backend connection and try again.'
            : 'Failed to initialize mock vehicles.';
      }
      });
  }

  startSimulation(): void {
    if (
      this.isInitializing ||
      this.isStarting ||
      this.isStopping ||
      this.isResettingFresh ||
      this.isSimulationRunning ||
      this.vehicles.length === 0
    ) {
      return;
    }
    this.isStarting = true;
    this.clearMessages();
    this.fleetApi
      .startSimulation()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isStarting = false;
        })
      )
      .subscribe({
      next: (response) => {
        if (!response.started) {
          this.errorMessage = response.reason || 'Unable to start simulation.';
          return;
        }
        this.message = 'Simulation started.';
        this.isSimulationRunning = true;
        this.loadVehicles();
        this.loadSimulationStatus();
      },
      error: (error: unknown) => {
        const httpError = error as HttpErrorResponse;
        this.errorMessage =
          this.isTimeoutError(error)
            ? 'Start request timed out. Check backend connection and try again.'
            : httpError.error?.reason || httpError.error?.message || 'Failed to start simulation.';
        if (httpError.error?.reason === 'Simulation already running.') {
          this.isSimulationRunning = true;
        }
      }
      });
  }

  stopSimulation(): void {
    if (this.isInitializing || this.isStarting || this.isStopping || this.isResettingFresh || !this.isSimulationRunning) {
      return;
    }
    this.isStopping = true;
    this.clearMessages();
    this.fleetApi
      .stopSimulation()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isStopping = false;
        })
      )
      .subscribe({
      next: () => {
        this.message = 'Simulation stopped.';
        this.isSimulationRunning = false;
        this.loadVehicles();
        this.loadSimulationStatus();
      },
      error: (error: unknown) => {
        this.errorMessage =
          this.isTimeoutError(error)
            ? 'Stop request timed out. Check backend connection and try again.'
            : 'Failed to stop simulation.';
      }
      });
  }

  injectIncidentNearFocusedVehicle(): void {
    const vehicle =
      this.vehicles.find((item) => item.vehicleId === this.selectedVehicleId) ||
      this.vehicles.find((item) => item.status === 'moving') ||
      this.vehicles[0];

    if (!vehicle) {
      this.errorMessage = 'No vehicle available to inject incident.';
      return;
    }

    this.isInjectingIncident = true;
    this.clearMessages();
    this.fleetApi
      .injectIncidentNearVehicle(vehicle.vehicleId)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isInjectingIncident = false;
        })
      )
      .subscribe({
        next: () => {
          this.message = `Road block injected near ${vehicle.vehicleId}.`;
          this.loadIncidents();
        },
        error: (error: unknown) => {
          this.errorMessage = this.isTimeoutError(error)
            ? 'Incident injection timed out. Check backend connection and try again.'
            : 'Unable to inject incident.';
        }
      });
  }

  openResolveModal(incident: Incident): void {
    if (this.isInitializing || this.isStarting || this.isStopping || this.isResettingFresh) {
      this.errorMessage = 'Wait for current action to finish before resolving incidents.';
      return;
    }

    this.resolveModalError = '';
    this.isAlternateRouteSelected = false;
    this.isApplyingRoute = false;
    this.resolveModalIncident = incident;
    this.resolvePreview = this.buildLocalResolvePreview(incident);
    this.isLoadingResolvePreview = !this.resolvePreview;
    this.isResolveModalOpen = true;
    this.scheduleResolveMapRender();

    this.fleetApi
      .getIncidentResolvePreview(incident.incidentId, this.selectedVehicleId || undefined)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isLoadingResolvePreview = false;
        })
      )
      .subscribe({
        next: (response) => {
          this.resolvePreview = response.data;
          this.scheduleResolveMapRender();
        },
        error: (error: unknown) => {
          if (this.isTimeoutError(error)) {
            this.resolveModalError = this.resolvePreview
              ? 'Using local fallback preview. Server preview timed out.'
              : 'Route preview timed out. Please try again.';
            return;
          }

          const httpError = error as HttpErrorResponse;
          if (httpError.status === 404) {
            this.resolveModalError =
              'Incident no longer active. It may have been cleared after re-initialization. Please use a currently listed incident.';
            this.loadIncidents();
            return;
          }

          this.resolveModalError = this.resolvePreview
            ? 'Using local fallback preview. Server preview is unavailable right now.'
            : httpError.error?.message || 'Unable to load route preview for this incident. Please try again.';
        }
      });
  }

  closeResolveModal(): void {
    this.isResolveModalOpen = false;
    this.resolveModalIncident = undefined;
    this.resolvePreview = undefined;
    this.resolveModalError = '';
    this.isLoadingResolvePreview = false;
    this.isApplyingRoute = false;
    this.isAlternateRouteSelected = false;
    this.destroyResolveMap();
    if (this.resolveMapRenderTimer) {
      window.clearTimeout(this.resolveMapRenderTimer);
      this.resolveMapRenderTimer = undefined;
    }
  }

  applySelectedAlternateRoute(): void {
    if (!this.isAlternateRouteSelected || this.isApplyingRoute) {
      return;
    }

    const preview =
      this.resolvePreview ||
      (this.resolveModalIncident ? this.buildLocalResolvePreview(this.resolveModalIncident) : undefined);

    if (!preview) {
      this.resolveModalError = 'Route preview is still loading. Please wait a moment and try again.';
      return;
    }

    const payload: ApplyIncidentRoutePayload = {
      vehicleId: preview.vehicle.vehicleId,
      routePoints: preview.alternateRoutePoints,
      destination: preview.proposedDestination
    };

    this.isApplyingRoute = true;
    this.resolveModalError = '';

    this.fleetApi
      .applyIncidentRoute(preview.incident.incidentId, payload)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isApplyingRoute = false;
        })
      )
      .subscribe({
        next: (response) => {
          this.message = `Alternate route applied and incident ${response.data.incident.incidentId} resolved.`;
          this.selectedRoutePoints.delete(response.data.vehicle.vehicleId);
          this.upsertVehicles([response.data.vehicle]);
          this.loadVehicles();
          this.loadIncidents();
          this.loadReroutes();
          this.refreshHeatmap();
          this.closeResolveModal();
        },
        error: (error: unknown) => {
          const httpError = error as HttpErrorResponse;
          this.resolveModalError = this.isTimeoutError(error)
            ? 'Apply route timed out. Please try again.'
            : httpError.error?.message || 'Failed to apply alternate route. Please try again.';
        }
      });
  }

  selectAlternateRouteFromPanel(): void {
    if (!this.resolvePreview) {
      return;
    }
    this.setAlternateRouteSelected(true);
  }

  trackByVehicle(_index: number, vehicle: Vehicle): string {
    return vehicle.vehicleId;
  }

  trackByIncident(_index: number, incident: Incident): string {
    return incident.incidentId;
  }

  trackByReroute(_index: number, event: RerouteEvent): string {
    return `${event.vehicleId}-${event.timestamp}`;
  }

  get isAnalyzingVehicle(): boolean {
    return Boolean(this.selectedVehicleId);
  }

  get congestionSummary(): string {
    if (!this.heatmapPoints.length) {
      return 'No congestion points yet';
    }
    const high = this.heatmapPoints.filter((point) => point.congestionLevel === 'high').length;
    const medium = this.heatmapPoints.filter((point) => point.congestionLevel === 'medium').length;
    return `High: ${high} | Medium: ${medium}`;
  }

  async analyzeVehicle(vehicle: Vehicle): Promise<void> {
    if (this.isResettingFresh) {
      return;
    }
    this.selectedVehicleId = vehicle.vehicleId;
    this.routeZoomedVehicleId = null;
    this.clearMessages();
    this.message = `Analyzing ${vehicle.vehicleId}. Showing exact road route and live position.`;
    await this.ensureVehicleRoadRoute(vehicle);
    this.renderVehiclesOnMap();
  }

  resetVehicleFocus(): void {
    if (this.isResettingFresh) {
      return;
    }
    this.selectedVehicleId = null;
    this.routeZoomedVehicleId = null;
    this.clearMessages();
    this.message = 'Showing all vehicles on map.';
    if (this.selectedRouteLine && this.map) {
      this.map.removeLayer(this.selectedRouteLine);
      this.selectedRouteLine = undefined;
    }
    this.renderVehiclesOnMap();
  }

  private scheduleResolveMapRender(): void {
    if (this.resolveMapRenderTimer) {
      window.clearTimeout(this.resolveMapRenderTimer);
      this.resolveMapRenderTimer = undefined;
    }

    this.resolveMapRenderTimer = window.setTimeout(() => {
      this.resolveMapRenderTimer = undefined;
      this.renderResolvePreviewMap(0);
    }, 30);
  }

  private renderResolvePreviewMap(attempt: number): void {
    if (!this.isResolveModalOpen || typeof L === 'undefined') {
      return;
    }

    const mapElement = document.getElementById('incident-resolve-map');
    if (!mapElement || mapElement.clientWidth === 0 || mapElement.clientHeight === 0) {
      if (attempt < 10) {
        this.resolveMapRenderTimer = window.setTimeout(() => {
          this.resolveMapRenderTimer = undefined;
          this.renderResolvePreviewMap(attempt + 1);
        }, 80);
      } else {
        this.resolveModalError = 'Map container is not ready. Please close and reopen Resolve.';
      }
      return;
    }

    const fallbackVehicle =
      this.vehicles.find((item) => item.vehicleId === this.selectedVehicleId) ||
      this.vehicles.find((item) => item.status === 'moving') ||
      this.vehicles[0];
    const fallbackCenter =
      this.resolvePreview?.vehicle?.currentLocation || fallbackVehicle?.currentLocation || this.resolveModalIncident?.location;
    const initialCenter: [number, number] = fallbackCenter
      ? [fallbackCenter.lat, fallbackCenter.lng]
      : [13.0827, 80.2707];

    if (!this.resolveMap) {
      this.resolveMap = L.map('incident-resolve-map', { zoomControl: true, scrollWheelZoom: true }).setView(
        initialCenter,
        12
      );
    }

    if (!this.resolveTileLayer) {
      this.resolveTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.resolveMap);
    }

    this.clearResolvePreviewLayers();

    if (!this.resolvePreview) {
      // Base map fallback so popup always shows a map even if preview API is slow/fails.
      if (fallbackCenter) {
        this.resolveMap.setView([fallbackCenter.lat, fallbackCenter.lng], 12);
      }

      if (this.resolveModalIncident) {
        this.resolveIncidentMarker = L.circleMarker(
          [this.resolveModalIncident.location.lat, this.resolveModalIncident.location.lng],
          {
            radius: 8,
            color: '#dc2626',
            weight: 2,
            fillColor: '#ef4444',
            fillOpacity: 0.85
          }
        )
          .addTo(this.resolveMap)
          .bindPopup(`<b>${this.resolveModalIncident.incidentId}</b><br/>${this.resolveModalIncident.reason}`);
      }

      if (fallbackVehicle) {
        const vehicleMarkerIcon = L.divIcon({
          className: 'resolve-vehicle-pin',
          html:
            '<div style="width:20px;height:20px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;">V</div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        this.resolveVehicleMarker = L.marker([fallbackVehicle.currentLocation.lat, fallbackVehicle.currentLocation.lng], {
          icon: vehicleMarkerIcon
        })
          .addTo(this.resolveMap)
          .bindPopup(`<b>${fallbackVehicle.vehicleId}</b><br/>Current Position`);
      }

      for (const point of this.heatmapPoints) {
        const color = this.getHeatColor(point.intensity);
        const heatCircle = L.circle([point.lat, point.lng], {
          radius: 70 + point.intensity * 160,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.17 + point.intensity * 0.2,
          interactive: false
        }).addTo(this.resolveMap);
        this.resolveHeatLayers.push(heatCircle);
      }

      this.resolveMap.invalidateSize();
      return;
    }

    const currentPoints = this.resolvePreview.currentRoutePoints.map((point) => [point.lat, point.lng] as [number, number]);
    const alternatePoints = this.resolvePreview.alternateRoutePoints.map(
      (point) => [point.lat, point.lng] as [number, number]
    );

    this.resolveCurrentRouteLayer = L.polyline(currentPoints, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.9
    }).addTo(this.resolveMap);

    const selectAlternateRoute = (event?: any) => {
      event?.originalEvent?.preventDefault?.();
      event?.originalEvent?.stopPropagation?.();
      this.ngZone.run(() => {
        this.setAlternateRouteSelected(true);
      });
    };

    this.resolveAlternateRouteLayer = L.polyline(alternatePoints, {
      color: '#f97316',
      weight: 4,
      opacity: 0.9,
      dashArray: '10 8'
    })
      .addTo(this.resolveMap)
      .on('click', selectAlternateRoute)
      .on('mousedown', selectAlternateRoute)
      .on('touchstart', selectAlternateRoute);

    // Wide transparent hit layer to make alternate-route click highly reliable.
    this.resolveAlternateRouteHitLayer = L.polyline(alternatePoints, {
      color: '#000000',
      weight: 20,
      opacity: 0,
      interactive: true,
      bubblingMouseEvents: false
    })
      .addTo(this.resolveMap)
      .on('click', selectAlternateRoute)
      .on('mousedown', selectAlternateRoute)
      .on('touchstart', selectAlternateRoute);

    this.resolveSourceMarker = L.marker(
      [this.resolvePreview.vehicle.source.lat, this.resolvePreview.vehicle.source.lng],
      { icon: this.getSourceIcon() }
    )
      .addTo(this.resolveMap)
      .bindPopup(`<b>${this.resolvePreview.vehicle.vehicleId}</b><br/>Source`);

    this.resolveDestinationMarker = L.marker(
      [this.resolvePreview.proposedDestination.lat, this.resolvePreview.proposedDestination.lng],
      { icon: this.getDestinationIcon() }
    )
      .addTo(this.resolveMap)
      .bindPopup(`<b>${this.resolvePreview.vehicle.vehicleId}</b><br/>Proposed Destination`);

    const vehicleMarkerIcon = L.divIcon({
      className: 'resolve-vehicle-pin',
      html:
        '<div style="width:20px;height:20px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;">V</div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    this.resolveVehicleMarker = L.marker(
      [this.resolvePreview.vehicle.currentLocation.lat, this.resolvePreview.vehicle.currentLocation.lng],
      { icon: vehicleMarkerIcon }
    )
      .addTo(this.resolveMap)
      .bindPopup(`<b>${this.resolvePreview.vehicle.vehicleId}</b><br/>Current Position`);

    this.resolveIncidentMarker = L.circleMarker(
      [this.resolvePreview.incident.location.lat, this.resolvePreview.incident.location.lng],
      {
        radius: 8,
        color: '#dc2626',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.85
      }
    )
      .addTo(this.resolveMap)
      .bindPopup(`<b>${this.resolvePreview.incident.incidentId}</b><br/>${this.resolvePreview.incident.reason}`);

    for (const point of this.resolvePreview.heatmapPoints) {
      const color = this.getHeatColor(point.intensity);
      const heatCircle = L.circle([point.lat, point.lng], {
        radius: 70 + point.intensity * 160,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.17 + point.intensity * 0.2,
        interactive: false
      }).addTo(this.resolveMap);
      this.resolveHeatLayers.push(heatCircle);
    }

    this.resolveAlternateRouteLayer?.bringToFront();
    this.resolveAlternateRouteHitLayer?.bringToFront();

    const boundsPoints = [
      ...currentPoints,
      ...alternatePoints,
      [this.resolvePreview.vehicle.source.lat, this.resolvePreview.vehicle.source.lng] as [number, number],
      [this.resolvePreview.proposedDestination.lat, this.resolvePreview.proposedDestination.lng] as [number, number],
      [this.resolvePreview.vehicle.currentLocation.lat, this.resolvePreview.vehicle.currentLocation.lng] as [number, number],
      [this.resolvePreview.incident.location.lat, this.resolvePreview.incident.location.lng] as [number, number]
    ];
    this.resolveMap.fitBounds(L.latLngBounds(boundsPoints), { padding: [20, 20], maxZoom: 15 });

    this.highlightAlternateRoute(this.isAlternateRouteSelected);
    this.resolveMap.invalidateSize();
  }

  private setAlternateRouteSelected(selected: boolean): void {
    this.isAlternateRouteSelected = selected;
    this.highlightAlternateRoute(selected);
  }

  private highlightAlternateRoute(selected: boolean): void {
    if (!this.resolveAlternateRouteLayer) {
      return;
    }
    this.resolveAlternateRouteLayer.setStyle(
      selected
        ? { color: '#16a34a', weight: 6, opacity: 1, dashArray: undefined }
        : { color: '#f97316', weight: 4, opacity: 0.9, dashArray: '10 8' }
    );
  }

  private clearResolvePreviewLayers(): void {
    if (!this.resolveMap) {
      return;
    }

    const singleLayers = [
      this.resolveCurrentRouteLayer,
      this.resolveAlternateRouteLayer,
      this.resolveAlternateRouteHitLayer,
      this.resolveSourceMarker,
      this.resolveDestinationMarker,
      this.resolveVehicleMarker,
      this.resolveIncidentMarker
    ];

    for (const layer of singleLayers) {
      if (layer) {
        this.resolveMap.removeLayer(layer);
      }
    }

    for (const heatLayer of this.resolveHeatLayers) {
      this.resolveMap.removeLayer(heatLayer);
    }
    this.resolveHeatLayers = [];

    this.resolveCurrentRouteLayer = undefined;
    this.resolveAlternateRouteLayer = undefined;
    this.resolveAlternateRouteHitLayer = undefined;
    this.resolveSourceMarker = undefined;
    this.resolveDestinationMarker = undefined;
    this.resolveVehicleMarker = undefined;
    this.resolveIncidentMarker = undefined;
  }

  private destroyResolveMap(): void {
    if (!this.resolveMap) {
      return;
    }
    this.clearResolvePreviewLayers();
    this.resolveMap.remove();
    this.resolveMap = undefined;
    this.resolveTileLayer = undefined;
  }

  private initMap(): void {
    if (typeof L === 'undefined') {
      this.errorMessage = 'Leaflet map library not loaded.';
      return;
    }

    this.map = L.map('fleet-live-map', { zoomControl: true }).setView([13.0827, 80.2707], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.renderVehiclesOnMap();
    this.renderIncidentsOnMap();
    this.renderHeatmapOnMap();
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }

  private isTimeoutError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'TimeoutError'
    );
  }

  resetAllAndStartFresh(): void {
    if (
      this.isInitializing ||
      this.isStarting ||
      this.isStopping ||
      this.isInjectingIncident ||
      this.isApplyingRoute ||
      this.isResettingFresh
    ) {
      return;
    }

    this.isResettingFresh = true;
    this.clearMessages();
    if (this.isResolveModalOpen) {
      this.closeResolveModal();
    }

    this.selectedVehicleId = null;
    this.routeZoomedVehicleId = null;
    this.selectedRoutePoints.clear();
    if (this.selectedRouteLine && this.map) {
      this.map.removeLayer(this.selectedRouteLine);
      this.selectedRouteLine = undefined;
    }

    this.fleetApi
      .initMockVehicles()
      .pipe(
        timeout(20000),
        switchMap(() => this.fleetApi.startSimulation().pipe(timeout(20000))),
        finalize(() => {
          this.isResettingFresh = false;
        })
      )
      .subscribe({
        next: (startResponse) => {
          if (!startResponse.started) {
            this.errorMessage = startResponse.reason || 'Reset completed, but simulation could not start.';
            this.isSimulationRunning = false;
          } else {
            this.message = 'All state reset. Initialized and started fresh simulation.';
            this.isSimulationRunning = true;
          }
          this.loadVehicles();
          this.loadSimulationStatus();
          this.loadIncidents();
          this.loadReroutes();
          this.refreshHeatmap();
        },
        error: (error: unknown) => {
          const httpError = error as HttpErrorResponse;
          this.errorMessage =
            this.isTimeoutError(error)
              ? 'Reset timed out. Backend may be unavailable. Try again.'
              : httpError.error?.reason ||
                httpError.error?.message ||
                'Failed to reset and initialize fresh state.';
          this.loadVehicles();
          this.loadSimulationStatus();
          this.loadIncidents();
          this.loadReroutes();
          this.refreshHeatmap();
        }
      });
  }

  private loadVehicles(): void {
    this.fleetApi.getVehicles().subscribe({
      next: (response) => {
        this.upsertVehicles(response.data, true);
      },
      error: () => {
        this.errorMessage = 'Unable to load vehicles from backend.';
      }
    });
  }

  private loadSimulationStatus(): void {
    this.fleetApi.getSimulationStatus().subscribe({
      next: (status) => {
        this.isSimulationRunning = status.isRunning;
      },
      error: () => {
        this.errorMessage = 'Unable to load simulation status.';
      }
    });
  }

  private loadIncidents(): void {
    this.fleetApi.getIncidents().subscribe({
      next: (response) => {
        this.incidents = response.data;
        this.renderIncidentsOnMap();
      },
      error: () => {
        this.errorMessage = 'Unable to load incidents.';
      }
    });
  }

  private loadReroutes(): void {
    this.fleetApi.getReroutes().subscribe({
      next: (response) => {
        this.rerouteEvents = response.data;
      },
      error: () => {
        this.errorMessage = 'Unable to load reroute history.';
      }
    });
  }

  private refreshHeatmap(): void {
    if (this.heatmapRequestInFlight) {
      this.heatmapRefreshQueued = true;
      return;
    }

    const now = Date.now();
    const elapsedMs = now - this.lastHeatmapRefreshAt;
    if (elapsedMs < this.heatmapRefreshThrottleMs) {
      this.heatmapRefreshQueued = true;
      this.scheduleQueuedHeatmapRefresh(this.heatmapRefreshThrottleMs - elapsedMs);
      return;
    }

    this.lastHeatmapRefreshAt = now;
    this.heatmapRequestInFlight = true;
    this.fleetApi.getCongestionHeatmap().subscribe({
      next: (response) => {
        this.heatmapPoints = response.points;
        this.renderHeatmapOnMap();
      },
      error: () => {
        this.errorMessage = 'Unable to load congestion heatmap.';
      },
      complete: () => {
        this.heatmapRequestInFlight = false;
        if (this.heatmapRefreshQueued) {
          this.heatmapRefreshQueued = false;
          this.scheduleQueuedHeatmapRefresh(this.heatmapRefreshThrottleMs);
        }
      }
    });
  }

  private scheduleQueuedHeatmapRefresh(delayMs: number): void {
    if (this.heatmapRefreshTimerId) {
      return;
    }

    this.heatmapRefreshTimerId = window.setTimeout(() => {
      this.heatmapRefreshTimerId = undefined;
      if (!this.heatmapRefreshQueued) {
        return;
      }
      this.heatmapRefreshQueued = false;
      this.refreshHeatmap();
    }, Math.max(0, delayMs));
  }

  private initLiveUpdates(): void {
    this.fleetLive.connect();

    this.statusSub = this.fleetLive.simulationStatus$().subscribe((status) => {
      this.isSimulationRunning = status.isRunning;
    });

    this.updateSub = this.fleetLive.simulationUpdates$().subscribe((vehicles) => {
      this.upsertVehicles(vehicles);
    });

    this.incidentsSub = this.fleetLive.incidents$().subscribe((incidents) => {
      this.incidents = incidents;
      this.renderIncidentsOnMap();
    });

    this.rerouteSub = this.fleetLive.reroutes$().subscribe((event) => {
      this.rerouteEvents = [event, ...this.rerouteEvents].slice(0, 20);
      this.message = `${event.vehicleId} rerouted due to: ${event.reason}`;
    });

    this.rerouteHistorySub = this.fleetLive.rerouteHistory$().subscribe((events) => {
      if (!this.rerouteEvents.length) {
        this.rerouteEvents = events;
      }
    });
  }

  private upsertVehicles(updatedVehicles: Vehicle[], replaceMissing = false): void {
    const byVehicleId = new Map(this.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle]));
    const incomingVehicleIds = new Set<string>();

    for (const vehicle of updatedVehicles) {
      incomingVehicleIds.add(vehicle.vehicleId);
      const existing = byVehicleId.get(vehicle.vehicleId);
      if (existing && this.shouldKeepExistingVehicle(existing, vehicle)) {
        continue;
      }
      byVehicleId.set(vehicle.vehicleId, vehicle);
    }

    if (replaceMissing) {
      for (const existingVehicleId of Array.from(byVehicleId.keys())) {
        if (!incomingVehicleIds.has(existingVehicleId)) {
          byVehicleId.delete(existingVehicleId);
        }
      }
    }

    this.vehicles = Array.from(byVehicleId.values()).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    this.renderVehiclesOnMap();
  }

  private shouldKeepExistingVehicle(existing: Vehicle, incoming: Vehicle): boolean {
    const existingTimestamp = this.getTimestamp(existing.lastUpdated);
    const incomingTimestamp = this.getTimestamp(incoming.lastUpdated);

    if (existingTimestamp !== null && incomingTimestamp !== null && existingTimestamp > incomingTimestamp) {
      return true;
    }

    if (existingTimestamp === incomingTimestamp) {
      return this.getStatusRank(existing.status) > this.getStatusRank(incoming.status);
    }

    return false;
  }

  private getTimestamp(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private getStatusRank(status: Vehicle['status']): number {
    if (status === 'reached') {
      return 2;
    }
    if (status === 'moving') {
      return 1;
    }
    return 0;
  }

  private renderVehiclesOnMap(): void {
    if (!this.map) {
      return;
    }

    const vehiclesToRender = this.selectedVehicleId
      ? this.vehicles.filter((vehicle) => vehicle.vehicleId === this.selectedVehicleId)
      : this.vehicles;
    const activeIds = new Set(vehiclesToRender.map((vehicle) => vehicle.vehicleId));

    this.removeInactiveLayers(this.markers, activeIds);
    this.removeInactiveLayers(this.sourceMarkers, activeIds);
    this.removeInactiveLayers(this.destinationMarkers, activeIds);
    this.removeInactiveLayers(this.routeLines, activeIds);

    for (const vehicle of vehiclesToRender) {
      const markerColor = this.getMarkerColor(vehicle.status);
      const markerHtml = this.getVehicleIconSvg(markerColor);
      const icon = L.divIcon({
        className: 'fleet-marker',
        html: markerHtml,
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      const popup = `<b>${vehicle.vehicleId}</b><br/>${vehicle.name}<br/>Status: ${vehicle.status}<br/>Speed: ${vehicle.speedKmh} km/h<br/>Reroutes: ${vehicle.rerouteCount || 0}`;
      const marker = this.markers.get(vehicle.vehicleId);
      if (marker) {
        marker.setLatLng([vehicle.currentLocation.lat, vehicle.currentLocation.lng]);
        marker.setPopupContent(popup);
      } else {
        const createdMarker = L.marker([vehicle.currentLocation.lat, vehicle.currentLocation.lng], { icon })
          .addTo(this.map)
          .bindPopup(popup);
        this.markers.set(vehicle.vehicleId, createdMarker);
      }

      const sourceMarker = this.sourceMarkers.get(vehicle.vehicleId);
      if (sourceMarker) {
        sourceMarker.setLatLng([vehicle.source.lat, vehicle.source.lng]);
      } else {
        const createdSourceMarker = L.marker([vehicle.source.lat, vehicle.source.lng], {
          icon: this.getSourceIcon()
        })
          .addTo(this.map)
          .bindPopup(`<b>${vehicle.vehicleId}</b><br/>Source`);
        this.sourceMarkers.set(vehicle.vehicleId, createdSourceMarker);
      }

      const destinationMarker = this.destinationMarkers.get(vehicle.vehicleId);
      if (destinationMarker) {
        destinationMarker.setLatLng([vehicle.destination.lat, vehicle.destination.lng]);
      } else {
        const createdDestinationMarker = L.marker([vehicle.destination.lat, vehicle.destination.lng], {
          icon: this.getDestinationIcon()
        })
          .addTo(this.map)
          .bindPopup(`<b>${vehicle.vehicleId}</b><br/>Destination`);
        this.destinationMarkers.set(vehicle.vehicleId, createdDestinationMarker);
      }

      if (!this.selectedVehicleId) {
        const points = [
          [vehicle.source.lat, vehicle.source.lng],
          [vehicle.currentLocation.lat, vehicle.currentLocation.lng],
          [vehicle.destination.lat, vehicle.destination.lng]
        ];

        const existingLine = this.routeLines.get(vehicle.vehicleId);
        if (existingLine) {
          existingLine.setLatLngs(points);
        } else {
          const line = L.polyline(points, { color: markerColor, weight: 3, opacity: 0.8 }).addTo(this.map);
          this.routeLines.set(vehicle.vehicleId, line);
        }
      }
    }

    if (this.selectedVehicleId && vehiclesToRender.length === 1) {
      const selectedVehicle = vehiclesToRender[0];
      const routePoints = this.selectedRoutePoints.get(selectedVehicle.vehicleId);
      if (this.selectedRouteLine && this.map) {
        this.map.removeLayer(this.selectedRouteLine);
        this.selectedRouteLine = undefined;
      }

      if (routePoints && routePoints.length > 1) {
        this.selectedRouteLine = L.polyline(routePoints, {
          color: '#7c3aed',
          weight: 5,
          opacity: 0.9
        }).addTo(this.map);
      } else {
        this.selectedRouteLine = L.polyline(
          [
            [selectedVehicle.currentLocation.lat, selectedVehicle.currentLocation.lng],
            [selectedVehicle.destination.lat, selectedVehicle.destination.lng]
          ],
          { color: '#7c3aed', weight: 5, opacity: 0.8 }
        ).addTo(this.map);
      }
    } else if (this.selectedRouteLine && this.map) {
      this.map.removeLayer(this.selectedRouteLine);
      this.selectedRouteLine = undefined;
    }

    if (vehiclesToRender.length > 0) {
      const pointsForBounds = vehiclesToRender.flatMap((vehicle) => [
        [vehicle.source.lat, vehicle.source.lng],
        [vehicle.destination.lat, vehicle.destination.lng],
        [vehicle.currentLocation.lat, vehicle.currentLocation.lng]
      ]);

      if (this.selectedVehicleId && vehiclesToRender.length === 1) {
        const routePoints = this.selectedRoutePoints.get(vehiclesToRender[0].vehicleId);
        if (routePoints?.length) {
          pointsForBounds.push(...routePoints);
        }
      }

      const bounds = L.latLngBounds(pointsForBounds);
      if (this.selectedVehicleId) {
        if (this.routeZoomedVehicleId !== this.selectedVehicleId) {
          this.map.flyToBounds(bounds, { padding: [10, 10], maxZoom: 14 });
          this.routeZoomedVehicleId = this.selectedVehicleId;
        }
      } else {
        this.map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }

  private renderIncidentsOnMap(): void {
    if (!this.map) {
      return;
    }

    const activeIds = new Set(this.incidents.map((incident) => incident.incidentId));
    this.removeInactiveLayers(this.incidentMarkers, activeIds);
    this.removeInactiveLayers(this.incidentRadiusLayers, activeIds);

    for (const incident of this.incidents) {
      const popup = `<b>${incident.incidentId}</b><br/>${incident.reason}<br/>Severity: ${incident.severity}`;
      const marker = this.incidentMarkers.get(incident.incidentId);
      if (marker) {
        marker.setLatLng([incident.location.lat, incident.location.lng]);
        marker.setPopupContent(popup);
      } else {
        const createdMarker = L.circleMarker([incident.location.lat, incident.location.lng], {
          radius: 8,
          color: '#dc2626',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: 0.8
        })
          .addTo(this.map)
          .bindPopup(popup);
        this.incidentMarkers.set(incident.incidentId, createdMarker);
      }

      const radiusLayer = this.incidentRadiusLayers.get(incident.incidentId);
      if (radiusLayer) {
        radiusLayer.setLatLng([incident.location.lat, incident.location.lng]);
        radiusLayer.setRadius(incident.radiusMeters);
      } else {
        const createdRadius = L.circle([incident.location.lat, incident.location.lng], {
          radius: incident.radiusMeters,
          color: '#f97316',
          weight: 1,
          fillColor: '#fb923c',
          fillOpacity: 0.15
        }).addTo(this.map);
        this.incidentRadiusLayers.set(incident.incidentId, createdRadius);
      }
    }
  }

  private renderHeatmapOnMap(): void {
    if (!this.map) {
      return;
    }

    const activeIds = new Set(this.heatmapPoints.map((point) => point.vehicleId));
    this.removeInactiveLayers(this.heatLayers, activeIds);

    for (const point of this.heatmapPoints) {
      const color = this.getHeatColor(point.intensity);
      const radius = 80 + point.intensity * 170;
      const existingLayer = this.heatLayers.get(point.vehicleId);
      if (existingLayer) {
        existingLayer.setLatLng([point.lat, point.lng]);
        existingLayer.setStyle({ color, fillColor: color, fillOpacity: 0.2 + point.intensity * 0.2 });
        existingLayer.setRadius(radius);
      } else {
        const heatLayer = L.circle([point.lat, point.lng], {
          radius,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.2 + point.intensity * 0.2
        }).addTo(this.map);
        this.heatLayers.set(point.vehicleId, heatLayer);
      }
    }
  }

  private removeInactiveLayers(layerMap: Map<string, any>, activeIds: Set<string>): void {
    if (!this.map) {
      return;
    }
    for (const [id, layer] of layerMap.entries()) {
      if (!activeIds.has(id)) {
        this.map.removeLayer(layer);
        layerMap.delete(id);
      }
    }
  }

  private async ensureVehicleRoadRoute(vehicle: Vehicle): Promise<void> {
    this.isLoadingSelectedRoute = true;
    try {
      const routePoints = await this.fetchRoadRoutePoints(vehicle);
      this.selectedRoutePoints.set(vehicle.vehicleId, routePoints);
    } catch (error) {
      console.error('[FleetManagement] failed to fetch exact road route', error);
      this.errorMessage = 'Could not load exact road path. Showing fallback line.';
    } finally {
      this.isLoadingSelectedRoute = false;
    }
  }

  private async fetchRoadRoutePoints(vehicle: Vehicle): Promise<Array<[number, number]>> {
    const source = `${vehicle.currentLocation.lng},${vehicle.currentLocation.lat}`;
    const destination = `${vehicle.destination.lng},${vehicle.destination.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${source};${destination}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM route request failed with status ${response.status}`);
    }
    const data = await response.json();
    const coordinates: Array<[number, number]> | undefined = data?.routes?.[0]?.geometry?.coordinates;
    if (!coordinates?.length) {
      throw new Error('OSRM route response has no coordinates');
    }
    return coordinates.map(([lng, lat]) => [lat, lng]);
  }

  private getMarkerColor(status: Vehicle['status']): string {
    if (status === 'reached') {
      return '#16a34a';
    }
    if (status === 'moving') {
      return '#2563eb';
    }
    return '#f59e0b';
  }

  private getHeatColor(intensity: number): string {
    if (intensity >= 0.66) {
      return '#dc2626';
    }
    if (intensity >= 0.33) {
      return '#f59e0b';
    }
    return '#16a34a';
  }

  private getSourceIcon(): any {
    return L.divIcon({
      className: 'source-pin',
      html:
        '<div style="width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 0 0 1px #14532d;">S</div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  private getDestinationIcon(): any {
    return L.divIcon({
      className: 'destination-pin',
      html:
        '<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 0 0 1px #7f1d1d;">D</div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  private getVehicleIconSvg(color: string): string {
    return `<svg width="48" height="48" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 1px #0f172a);">
      <rect x="4" y="8" width="11" height="7" rx="1.5" fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      <rect x="15" y="10" width="4" height="5" rx="1" fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="8" cy="16.5" r="1.8" fill="#0f172a"/>
      <circle cx="16" cy="16.5" r="1.8" fill="#0f172a"/>
    </svg>`;
  }

  private buildLocalResolvePreview(incident: Incident): IncidentResolvePreview | undefined {
    const fallbackVehicle =
      this.vehicles.find((item) => item.vehicleId === this.selectedVehicleId) ||
      this.vehicles.find((item) => item.status === 'moving') ||
      this.vehicles[0];

    if (!fallbackVehicle) {
      return undefined;
    }

    const currentRoutePoints = [fallbackVehicle.currentLocation, fallbackVehicle.destination];
    const midpoint = {
      lat: (fallbackVehicle.currentLocation.lat + fallbackVehicle.destination.lat) / 2,
      lng: (fallbackVehicle.currentLocation.lng + fallbackVehicle.destination.lng) / 2
    };
    const alternateWaypoint = {
      lat: midpoint.lat + 0.0038,
      lng: midpoint.lng - 0.0032
    };
    const alternateRoutePoints = [fallbackVehicle.currentLocation, alternateWaypoint, fallbackVehicle.destination];

    return {
      incident,
      vehicle: fallbackVehicle,
      currentRoutePoints,
      alternateRoutePoints,
      proposedDestination: fallbackVehicle.destination,
      heatmapPoints: this.heatmapPoints
    };
  }
}
