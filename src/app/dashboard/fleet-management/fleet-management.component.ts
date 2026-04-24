import { AfterViewInit, ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, Subscription, switchMap, timeout } from 'rxjs';
import { FleetApiService } from '../../core/services/fleet-api.service';
import { FleetLiveService } from '../../core/services/fleet-live.service';
import {
  AlternateRouteOption,
  ApplyIncidentRoutePayload,
  HeatmapPoint,
  Incident,
  IncidentResolvePreview,
  RerouteEvent,
  GeofenceBreach,
  Vehicle,
  VehicleOverview
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
  isGeofenceModeActive = false;
  selectedVehicleId: string | null = null;
  isLoadingSelectedRoute = false;
  isResolveModalOpen = false;
  isVehicleOverviewModalOpen = false;
  isLoadingVehicleOverview = false;
  isLoadingResolvePreview = false;
  isApplyingRoute = false;
  isResolveRouteApplied = false;
  isAlternateRouteSelected = false;
  selectedAlternateRouteId: string | null = null;
  resolveModalError = '';
  resolveModalSuccess = '';
  vehicleOverviewError = '';
  resolveModalIncident?: Incident;
  resolvePreview?: IncidentResolvePreview;
  vehicleOverview?: VehicleOverview;
  isGeofenceToggling = false;
  geofenceBreaches: GeofenceBreach[] = [];
  selectedGeofenceVehicleId: string | null = null;

  private map?: any;
  private markers = new Map<string, any>();
  private sourceMarkers = new Map<string, any>();
  private destinationMarkers = new Map<string, any>();
  private routeLines = new Map<string, any>();
  private routeCompletedLines = new Map<string, any>();
  private primaryMapRoutePoints = new Map<string, Array<[number, number]>>();
  private primaryMapRouteSignatures = new Map<string, string>();
  private primaryMapRouteRequests = new Set<string>();
  private incidentMarkers = new Map<string, any>();
  private incidentRadiusLayers = new Map<string, any>();
  private heatLayers = new Map<string, any>();
  private selectedRouteLine?: any;
  private selectedRoutePoints = new Map<string, Array<[number, number]>>();
  private geofenceRouteLayer?: any;
  private geofenceCircleLayer?: any;
  private geofenceBreachMarker?: any;
  private geofenceVehicleMarker?: any;
  private routeZoomedVehicleId: string | null = null;
  private statusSub?: Subscription;
  private updateSub?: Subscription;
  private incidentsSub?: Subscription;
  private rerouteSub?: Subscription;
  private rerouteHistorySub?: Subscription;
  private geofenceBreachSub?: Subscription;
  private geofenceClearSub?: Subscription;
  private heatmapIntervalId?: number;
  private heatmapRefreshTimerId?: number;
  private heatmapRefreshQueued = false;
  private heatmapRequestInFlight = false;
  private lastHeatmapRefreshAt = 0;
  private readonly heatmapRefreshThrottleMs = 2500;
  private resolveMap?: any;
  private resolveTileLayer?: any;
  private resolveCurrentRouteLayer?: any;
  private resolveAlternateRouteLayers = new Map<string, any>();
  private resolveAlternateRouteHitLayers = new Map<string, any>();
  private resolveAlternateRouteColors = new Map<string, string>();
  private resolveSourceMarker?: any;
  private resolveDestinationMarker?: any;
  private resolveVehicleMarker?: any;
  private resolveIncidentMarker?: any;
  private resolveHeatLayers: any[] = [];
  private resolveMapRenderTimer?: number;
  private applyRouteWatchdogTimer?: number;
  private mapResizeObserver?: ResizeObserver;
  private handleWindowResize = (): void => {
    this.map?.invalidateSize();
  };

  constructor(
    private readonly fleetApi: FleetApiService,
    private readonly fleetLive: FleetLiveService,
    private readonly ngZone: NgZone,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadVehicles();
    this.loadSimulationStatus();
    this.loadIncidents();
    this.loadReroutes();
    this.initLiveUpdates();
    this.loadGeofenceBreaches();
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
    this.geofenceBreachSub?.unsubscribe();
    this.geofenceClearSub?.unsubscribe();
    if (this.heatmapIntervalId) {
      window.clearInterval(this.heatmapIntervalId);
    }
    if (this.heatmapRefreshTimerId) {
      window.clearTimeout(this.heatmapRefreshTimerId);
      this.heatmapRefreshTimerId = undefined;
    }
    this.fleetLive.disconnect();
    this.clearGeofenceLayers();
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
    if (this.applyRouteWatchdogTimer) {
      window.clearTimeout(this.applyRouteWatchdogTimer);
      this.applyRouteWatchdogTimer = undefined;
    }
    window.removeEventListener('resize', this.handleWindowResize);
    if (this.mapResizeObserver) {
      this.mapResizeObserver.disconnect();
      this.mapResizeObserver = undefined;
    }
  }

  initMockVehicles(): void {
    if (this.isInitializing || this.isStarting || this.isStopping) {
      return;
    }
    this.setInitializing(true);
    this.clearMessages();
    this.fleetApi
      .initMockVehicles()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.setInitializing(false);
        })
      )
      .subscribe({
      next: (response) => {
        this.runInUiContext(() => {
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
        });
      },
      error: (error: unknown) => {
        this.runInUiContext(() => {
          this.errorMessage =
            this.isTimeoutError(error)
              ? 'Initialize request timed out. Check backend connection and try again.'
              : 'Failed to initialize mock vehicles.';
        });
      }
      });
  }

  startSimulation(): void {
    if (
      this.isStarting ||
      this.isStopping ||
      this.isSimulationRunning ||
      this.vehicles.length === 0
    ) {
      return;
    }
    this.setStarting(true);
    this.clearMessages();
    this.fleetApi
      .startSimulation()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.setStarting(false);
        })
      )
      .subscribe({
      next: (response) => {
        this.runInUiContext(() => {
          if (!response.started) {
            this.errorMessage = response.reason || 'Unable to start simulation.';
            return;
          }
          this.message = 'Simulation started.';
          this.isSimulationRunning = true;
          this.loadVehicles();
          this.loadSimulationStatus();
        });
      },
      error: (error: unknown) => {
        this.runInUiContext(() => {
          const httpError = error as HttpErrorResponse;
          this.errorMessage =
            this.isTimeoutError(error)
              ? 'Start request timed out. Check backend connection and try again.'
              : httpError.error?.reason || httpError.error?.message || 'Failed to start simulation.';
          if (httpError.error?.reason === 'Simulation already running.') {
            this.isSimulationRunning = true;
          }
        });
      }
      });
  }

  stopSimulation(): void {
    if (this.isStarting || this.isStopping || !this.isSimulationRunning) {
      return;
    }
    this.setStopping(true);
    this.clearMessages();
    this.fleetApi
      .stopSimulation()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.setStopping(false);
        })
      )
      .subscribe({
      next: () => {
        this.runInUiContext(() => {
          this.message = 'Simulation stopped.';
          this.isSimulationRunning = false;
          this.loadVehicles();
          this.loadSimulationStatus();
        });
      },
      error: (error: unknown) => {
        this.runInUiContext(() => {
          this.errorMessage =
            this.isTimeoutError(error)
              ? 'Stop request timed out. Check backend connection and try again.'
              : 'Failed to stop simulation.';
        });
      }
      });
  }

  injectIncidentNearFocusedVehicle(): void {
    const eligibleVehicles = this.vehicles.filter((item) => this.isVehicleBetweenSourceAndDestination(item));

    if (!eligibleVehicles.length) {
      this.errorMessage = 'No vehicle is currently between its source and destination to inject a road block.';
      return;
    }

    this.isInjectingIncident = true;
    this.clearMessages();
    this.fleetApi
      .injectIncidentForTransitVehicles()
      .pipe(
        timeout(20000),
        finalize(() => {
          this.isInjectingIncident = false;
        })
      )
      .subscribe({
        next: (response) => {
          const affectedCount = response.affectedVehicleIds?.length || eligibleVehicles.length;
          this.message = `Road blocks injected for ${affectedCount} active vehicle(s).`;
          this.loadIncidents();
      },
      error: (error: unknown) => {
        this.errorMessage = this.isTimeoutError(error)
          ? 'Incident injection timed out. Check backend connection and try again.'
          : 'Unable to inject incident.';
      }
    });
  }

  toggleGeofenceMode(): void {
    if (this.isStarting || this.isStopping) {
      return;
    }
    this.setGeofenceMonitoring(!this.isGeofenceModeActive);
  }

  openResolveModal(incident: Incident): void {
    if (this.isStarting || this.isStopping) {
      this.errorMessage = 'Wait for current action to finish before resolving incidents.';
      return;
    }

    this.resolveModalError = '';
    this.resolveModalSuccess = '';
    this.isResolveRouteApplied = false;
    this.isAlternateRouteSelected = false;
    this.selectedAlternateRouteId = null;
    this.setApplyingRoute(false);
    this.resolveModalIncident = incident;
    this.resolvePreview = this.buildLocalResolvePreview(incident);
    this.isLoadingResolvePreview = !this.resolvePreview;
    this.isResolveModalOpen = true;
    this.scheduleResolveMapRender();

    const incidentVehicleHint = this.getVehicleIdHintFromIncidentReason(incident.reason);
    const preferredVehicleId = incidentVehicleHint || this.selectedVehicleId || undefined;

    this.fleetApi
      .getIncidentResolvePreview(incident.incidentId, preferredVehicleId)
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
    this.resolveModalSuccess = '';
    this.isLoadingResolvePreview = false;
    this.isResolveRouteApplied = false;
    this.setApplyingRoute(false);
    this.isAlternateRouteSelected = false;
    this.selectedAlternateRouteId = null;
    this.clearApplyRouteWatchdog();
    this.destroyResolveMap();
    if (this.resolveMapRenderTimer) {
      window.clearTimeout(this.resolveMapRenderTimer);
      this.resolveMapRenderTimer = undefined;
    }
  }

  applySelectedAlternateRoute(): void {
    if (!this.isAlternateRouteSelected || this.isApplyingRoute || this.isResolveRouteApplied) {
      return;
    }

    const preview =
      this.resolvePreview ||
      (this.resolveModalIncident ? this.buildLocalResolvePreview(this.resolveModalIncident) : undefined);

    if (!preview) {
      this.resolveModalError = 'Route preview is still loading. Please wait a moment and try again.';
      return;
    }

    const selectedAlternateRoute = this.getSelectedAlternateRoute(preview);
    const payload: ApplyIncidentRoutePayload = {
      vehicleId: preview.vehicle.vehicleId,
      alternateRouteId: selectedAlternateRoute?.routeId,
      destination: preview.proposedDestination
    };

    this.setApplyingRoute(true);
    this.resolveModalError = '';
    this.resolveModalSuccess = '';
    this.clearApplyRouteWatchdog();
    this.applyRouteWatchdogTimer = window.setTimeout(() => {
      if (!this.isApplyingRoute) {
        return;
      }
      this.runInUiContext(() => {
        this.setApplyingRoute(false);
        this.resolveModalError = 'Apply request took too long. Please try again.';
      });
    }, 25000);

    this.fleetApi
      .applyIncidentRoute(preview.incident.incidentId, payload)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.setApplyingRoute(false);
          this.clearApplyRouteWatchdog();
        })
      )
      .subscribe({
        next: (response) => {
          this.runInUiContext(() => {
            this.setApplyingRoute(false);
            this.clearApplyRouteWatchdog();
            try {
              const appliedIncidentId = response.data?.incident?.incidentId || preview.incident.incidentId;
              const appliedVehicle = response.data?.vehicle;
              this.message = `Alternate route applied and incident ${appliedIncidentId} resolved.`;
              this.resolveModalSuccess = `Applied successfully. Incident ${appliedIncidentId} is resolved.`;
              this.isResolveRouteApplied = true;
              this.isAlternateRouteSelected = false;
              if (this.resolvePreview) {
                this.resolvePreview = {
                  ...this.resolvePreview,
                  incident: {
                    ...this.resolvePreview.incident,
                    status: 'resolved',
                    resolvedAt: new Date().toISOString()
                  }
                };
              }
              this.resolveMap?.invalidateSize();
              if (appliedVehicle) {
                this.selectedRoutePoints.delete(appliedVehicle.vehicleId);
                this.upsertVehicles([appliedVehicle]);
              }
              this.loadVehicles();
              this.loadIncidents();
              this.loadReroutes();
              this.refreshHeatmap();
            } catch (_error) {
              this.errorMessage = 'Route was applied, but UI refresh failed. Reloading live data.';
              this.resolveModalSuccess = 'Route applied. Live data refreshed.';
              this.isResolveRouteApplied = true;
              this.isAlternateRouteSelected = false;
              this.loadVehicles();
              this.loadIncidents();
              this.loadReroutes();
              this.refreshHeatmap();
            }
          });
        },
        error: (error: unknown) => {
          this.runInUiContext(() => {
            this.setApplyingRoute(false);
            this.clearApplyRouteWatchdog();
            const httpError = error as HttpErrorResponse;
            this.resolveModalError = this.isTimeoutError(error)
              ? 'Apply route timed out. Please try again.'
              : httpError.error?.message || 'Failed to apply alternate route. Please try again.';
          });
        }
      });
  }

  selectAlternateRoute(routeId: string): void {
    this.setAlternateRouteSelected(true, routeId);
  }

  get resolveAlternateOptions(): AlternateRouteOption[] {
    if (!this.resolvePreview) {
      return [];
    }
    return this.getResolveAlternateOptions(this.resolvePreview);
  }

  isAlternateRouteActive(routeId: string): boolean {
    return this.isAlternateRouteSelected && this.selectedAlternateRouteId === routeId;
  }

  private getSelectedAlternateRoute(preview: IncidentResolvePreview): AlternateRouteOption | undefined {
    const options = this.getResolveAlternateOptions(preview);
    if (!options.length) {
      return undefined;
    }
    if (this.selectedAlternateRouteId) {
      const selected = options.find((option) => option.routeId === this.selectedAlternateRouteId);
      if (selected) {
        return selected;
      }
    }
    return options[0];
  }

  private getResolveAlternateOptions(preview: IncidentResolvePreview): AlternateRouteOption[] {
    const options = Array.isArray(preview.alternateRouteOptions) ? preview.alternateRouteOptions : [];
    const validOptions = options.filter((option) => Array.isArray(option.routePoints) && option.routePoints.length >= 2);
    if (validOptions.length) {
      return validOptions;
    }
    if (Array.isArray(preview.alternateRoutePoints) && preview.alternateRoutePoints.length >= 2) {
      return [
        {
          routeId: 'alt-1',
          label: 'Alternate Route 1',
          routePoints: preview.alternateRoutePoints
        }
      ];
    }
    return [];
  }

  private getAlternateRouteColor(index: number): string {
    const palette = ['#ff1fa3', '#00d4ff'];
    return palette[index % palette.length];
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

  openVehicleOverview(vehicle: Vehicle): void {
    this.runInUiContext(() => {
      this.vehicleOverviewError = '';
      this.vehicleOverview = undefined;
      this.isVehicleOverviewModalOpen = true;
      this.isLoadingVehicleOverview = true;
    });

    this.fleetApi
      .getVehicleOverview(vehicle.vehicleId)
      .pipe(
        timeout(20000),
        finalize(() => {
          this.runInUiContext(() => {
            this.isLoadingVehicleOverview = false;
          });
        })
      )
      .subscribe({
        next: (response) => {
          this.runInUiContext(() => {
            this.vehicleOverview = response.data;
          });
        },
        error: (error: unknown) => {
          this.runInUiContext(() => {
            const httpError = error as HttpErrorResponse;
            this.vehicleOverviewError = this.isTimeoutError(error)
              ? 'Overview request timed out. Please try again.'
              : httpError.error?.message || 'Unable to load vehicle overview.';
          });
        }
      });
  }

  closeVehicleOverviewModal(): void {
    this.isVehicleOverviewModalOpen = false;
    this.isLoadingVehicleOverview = false;
    this.vehicleOverviewError = '';
    this.vehicleOverview = undefined;
  }

  get isAnalyzingVehicle(): boolean {
    return Boolean(this.selectedVehicleId);
  }

  get hasInjectableVehicle(): boolean {
    return this.vehicles.some((vehicle) => this.isVehicleBetweenSourceAndDestination(vehicle));
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
    this.selectedVehicleId = vehicle.vehicleId;
    this.routeZoomedVehicleId = null;
    this.clearMessages();
    this.message = `Analyzing ${vehicle.vehicleId}. Showing exact road route and live position.`;
    await this.ensureVehicleRoadRoute(vehicle);
    this.renderVehiclesOnMap();
  }

  resetVehicleFocus(): void {
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
      window.setTimeout(() => {
        this.recoverResolveMapIfBlank();
      }, 900);
    }, 30);
  }

  private recoverResolveMapIfBlank(): void {
    if (!this.isResolveModalOpen) {
      return;
    }
    if (this.isApplyingRoute) {
      this.resolveMap?.invalidateSize();
      return;
    }

    const mapElement = document.getElementById('incident-resolve-map');
    if (!mapElement) {
      return;
    }

    const paneCount = mapElement.querySelectorAll('.leaflet-pane').length;
    if (paneCount > 0) {
      this.resolveMap?.invalidateSize();
      return;
    }

    this.destroyResolveMap();
    this.scheduleResolveMapRender();
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

    try {
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
          this.resolveIncidentMarker = L.marker(
            [this.resolveModalIncident.location.lat, this.resolveModalIncident.location.lng],
            { icon: this.getIncidentBlockIcon() }
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
          const visibleIntensity = Math.max(point.intensity, 0.35);
          const heatCircle = L.circle([point.lat, point.lng], {
            radius: 120 + visibleIntensity * 220,
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.28 + visibleIntensity * 0.35,
            interactive: false
          }).addTo(this.resolveMap);
          this.resolveHeatLayers.push(heatCircle);
        }

        this.resolveMap.invalidateSize();
        return;
      }

      const currentPoints = this.resolvePreview.currentRoutePoints.map((point) => [point.lat, point.lng] as [number, number]);
      const alternateOptions = this.getResolveAlternateOptions(this.resolvePreview);

      this.resolveCurrentRouteLayer = L.polyline(currentPoints, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.9
      }).addTo(this.resolveMap);

      for (const [index, option] of alternateOptions.entries()) {
        const alternatePoints = option.routePoints.map((point) => [point.lat, point.lng] as [number, number]);
        if (alternatePoints.length < 2) {
          continue;
        }

        const color = this.getAlternateRouteColor(index);
        this.resolveAlternateRouteColors.set(option.routeId, color);

        const selectAlternateRoute = (event?: any) => {
          event?.originalEvent?.preventDefault?.();
          event?.originalEvent?.stopPropagation?.();
          this.ngZone.run(() => {
            this.setAlternateRouteSelected(true, option.routeId);
          });
        };

        const routeLayer = L.polyline(alternatePoints, {
          color,
          weight: 4,
          opacity: 0.95,
          dashArray: '11 7'
        })
          .addTo(this.resolveMap)
          .on('click', selectAlternateRoute)
          .on('mousedown', selectAlternateRoute)
          .on('touchstart', selectAlternateRoute);
        this.resolveAlternateRouteLayers.set(option.routeId, routeLayer);

        const hitLayer = L.polyline(alternatePoints, {
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
        this.resolveAlternateRouteHitLayers.set(option.routeId, hitLayer);
      }

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

      this.resolveIncidentMarker = L.marker(
        [this.resolvePreview.incident.location.lat, this.resolvePreview.incident.location.lng],
        { icon: this.getIncidentBlockIcon() }
      )
        .addTo(this.resolveMap)
        .bindPopup(`<b>${this.resolvePreview.incident.incidentId}</b><br/>${this.resolvePreview.incident.reason}`);

      for (const point of this.resolvePreview.heatmapPoints) {
        const color = this.getHeatColor(point.intensity);
        const visibleIntensity = Math.max(point.intensity, 0.35);
        const heatCircle = L.circle([point.lat, point.lng], {
          radius: 120 + visibleIntensity * 220,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.28 + visibleIntensity * 0.35,
          interactive: false
        }).addTo(this.resolveMap);
        this.resolveHeatLayers.push(heatCircle);
      }

      for (const routeLayer of this.resolveAlternateRouteLayers.values()) {
        routeLayer.bringToFront();
      }
      for (const hitLayer of this.resolveAlternateRouteHitLayers.values()) {
        hitLayer.bringToFront();
      }

      const boundsPoints = [
        ...currentPoints,
        [this.resolvePreview.vehicle.source.lat, this.resolvePreview.vehicle.source.lng] as [number, number],
        [this.resolvePreview.proposedDestination.lat, this.resolvePreview.proposedDestination.lng] as [number, number],
        [this.resolvePreview.vehicle.currentLocation.lat, this.resolvePreview.vehicle.currentLocation.lng] as [number, number],
        [this.resolvePreview.incident.location.lat, this.resolvePreview.incident.location.lng] as [number, number]
      ];
      for (const option of alternateOptions) {
        boundsPoints.push(...option.routePoints.map((point) => [point.lat, point.lng] as [number, number]));
      }
      this.resolveMap.fitBounds(L.latLngBounds(boundsPoints), { padding: [20, 20], maxZoom: 15 });

      if (
        this.selectedAlternateRouteId &&
        !alternateOptions.some((option) => option.routeId === this.selectedAlternateRouteId)
      ) {
        this.selectedAlternateRouteId = null;
        this.isAlternateRouteSelected = false;
      }
      this.highlightAlternateRoute();
      this.resolveMap.invalidateSize();
    } catch (_error) {
      this.resolveModalError = 'Unable to render route map right now. Close and reopen Resolve.';
    }
  }

  private setAlternateRouteSelected(selected: boolean, routeId?: string): void {
    this.isAlternateRouteSelected = selected;
    if (!selected) {
      this.selectedAlternateRouteId = null;
      this.highlightAlternateRoute();
      return;
    }

    this.selectedAlternateRouteId = routeId || this.selectedAlternateRouteId || null;
    this.highlightAlternateRoute();
  }

  private highlightAlternateRoute(): void {
    for (const [routeId, routeLayer] of this.resolveAlternateRouteLayers.entries()) {
      const color = this.resolveAlternateRouteColors.get(routeId) || '#f97316';
      const selected = this.isAlternateRouteSelected && this.selectedAlternateRouteId === routeId;
      routeLayer.setStyle(
        selected
          ? { color, weight: 7, opacity: 1, dashArray: undefined }
          : { color, weight: 4, opacity: 0.95, dashArray: '11 7' }
      );
    }
  }

  private clearResolvePreviewLayers(): void {
    if (!this.resolveMap) {
      return;
    }

    const singleLayers = [
      this.resolveCurrentRouteLayer,
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
    for (const routeLayer of this.resolveAlternateRouteLayers.values()) {
      this.resolveMap.removeLayer(routeLayer);
    }
    for (const hitLayer of this.resolveAlternateRouteHitLayers.values()) {
      this.resolveMap.removeLayer(hitLayer);
    }
    this.resolveAlternateRouteLayers.clear();
    this.resolveAlternateRouteHitLayers.clear();
    this.resolveAlternateRouteColors.clear();

    this.resolveCurrentRouteLayer = undefined;
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
    this.setupMapResizeHandling();

    this.renderVehiclesOnMap();
    this.renderIncidentsOnMap();
    this.renderHeatmapOnMap();
  }

  private setupMapResizeHandling(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('resize', this.handleWindowResize);
    window.requestAnimationFrame(() => this.handleWindowResize());

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    if (typeof document === 'undefined') {
      return;
    }

    const mapElement = document.getElementById('fleet-live-map');
    if (!mapElement) {
      return;
    }

    this.mapResizeObserver = new ResizeObserver(() => this.handleWindowResize());
    this.mapResizeObserver.observe(mapElement);
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }

  private setGeofenceMonitoring(active: boolean): void {
    if (this.isGeofenceToggling) {
      return;
    }
    this.isGeofenceToggling = true;
    this.clearMessages();

    this.fleetApi
      .setGeofenceMonitoring(active)
      .pipe(
        finalize(() => {
          this.isGeofenceToggling = false;
        })
      )
      .subscribe({
        next: (response) => {
          this.isGeofenceModeActive = response.active;
          this.message = response.active
            ? 'Geofence monitoring enabled. Vehicles breaching the assigned corridors will be highlighted.'
            : 'Geofence monitoring disabled.';

          if (response.active) {
            this.loadGeofenceBreaches(true);
          } else {
            this.geofenceBreaches = [];
            this.selectedGeofenceVehicleId = null;
            this.clearGeofenceLayers();
          }
        },
        error: (error: unknown) => {
          this.errorMessage = this.isTimeoutError(error)
            ? 'Geofence toggle request timed out. Please try again.'
            : 'Failed to update geofence monitoring state.';
        }
      });
  }

  private loadGeofenceBreaches(forceIfEmpty = false): void {
    this.fleetApi.getGeofenceBreaches().subscribe({
      next: (response) => {
        this.geofenceBreaches = response.data;
        if (this.geofenceBreaches.length) {
          const firstBreach = this.geofenceBreaches[0];
          this.selectedGeofenceVehicleId = firstBreach.vehicleId;
          this.showGeofenceDetails(firstBreach);
        } else if (forceIfEmpty && this.isGeofenceModeActive && this.vehicles.length) {
          this.forceInitialGeofenceBreach();
        } else {
          this.selectedGeofenceVehicleId = null;
          this.clearGeofenceLayers();
        }
      },
      error: () => {
        this.errorMessage = 'Unable to load current geofence breaches.';
      }
    });
  }

  private forceInitialGeofenceBreach(): void {
    const fallbackVehicleId = this.selectedVehicleId || this.vehicles[0]?.vehicleId;
    this.fleetApi.forceGeofenceBreach(fallbackVehicleId).subscribe({
      next: (response) => {
        const breach = response.data;
        const remaining = this.geofenceBreaches.filter((item) => item.vehicleId !== breach.vehicleId);
        this.geofenceBreaches = [breach, ...remaining];
        this.selectedGeofenceVehicleId = breach.vehicleId;
        this.showGeofenceDetails(breach);
      },
      error: () => {
        this.errorMessage = 'Unable to force a geofence breach for the current fleet state.';
      }
    });
  }

  private handleGeofenceBreachEvent(breach: GeofenceBreach): void {
    if (!breach) {
      return;
    }

    const remaining = this.geofenceBreaches.filter((item) => item.vehicleId !== breach.vehicleId);
    this.geofenceBreaches = [breach, ...remaining];
    this.selectedGeofenceVehicleId = breach.vehicleId;
    this.showGeofenceDetails(breach);
  }

  private handleGeofenceClearEvent(vehicleId: string): void {
    if (!vehicleId) {
      return;
    }

    const remaining = this.geofenceBreaches.filter((item) => item.vehicleId !== vehicleId);
    this.geofenceBreaches = remaining;

    if (this.selectedGeofenceVehicleId === vehicleId) {
      if (remaining.length) {
        const nextBreach = remaining[0];
        this.selectedGeofenceVehicleId = nextBreach.vehicleId;
        this.showGeofenceDetails(nextBreach);
      } else {
        this.selectedGeofenceVehicleId = null;
        this.clearGeofenceLayers();
      }
    }
  }

  showGeofenceDetails(breach: GeofenceBreach): void {
    if (!this.map || !breach || !Array.isArray(breach.routePoints) || breach.routePoints.length < 2) {
      return;
    }

    this.selectedGeofenceVehicleId = breach.vehicleId;
    this.clearGeofenceLayers();
    const geofenceDisplayRadius = Math.max(breach.toleranceMeters * 2.35, breach.toleranceMeters + 240);
    const routeLayer = L.polyline(breach.routePoints, {
      color: '#a855f7',
      weight: 6,
      dashArray: '10 6',
      opacity: 0.85
    }).addTo(this.map);

    const circleLayer = L.circle([breach.breachAt.lat, breach.breachAt.lng], {
      radius: geofenceDisplayRadius,
      color: '#ef4444',
      weight: 3,
      fillColor: 'rgba(239, 68, 68, 0.18)',
      fillOpacity: 0.32
    }).addTo(this.map);

    const breachMarker = L.marker([breach.breachAt.lat, breach.breachAt.lng], {
      icon: this.getGeofenceBreachIcon()
    })
      .addTo(this.map)
      .bindPopup(
        `<b>${breach.vehicleId}</b><br/>Breached route by ${breach.breachDistanceMeters.toFixed(0)} m<br/>Tolerance ${breach.toleranceMeters} m<br/>Fence view ${geofenceDisplayRadius.toFixed(0)} m`
      );

    const liveVehicle = this.vehicles.find((item) => item.vehicleId === breach.vehicleId);
    let vehicleMarker: any;
    if (liveVehicle) {
      vehicleMarker = L.marker([liveVehicle.currentLocation.lat, liveVehicle.currentLocation.lng], {
        icon: this.getGeofenceVehicleIcon()
      })
        .addTo(this.map)
        .bindPopup(
          `<b>${liveVehicle.vehicleId}</b><br/>${liveVehicle.name}<br/>Status: ${liveVehicle.status}<br/>Speed: ${liveVehicle.speedKmh} km/h`
        );
    }

    this.geofenceRouteLayer = routeLayer;
    this.geofenceCircleLayer = circleLayer;
    this.geofenceBreachMarker = breachMarker;
    this.geofenceVehicleMarker = vehicleMarker;
    if (routeLayer.getBounds) {
      const bounds = routeLayer.getBounds();
      bounds.extend(circleLayer.getBounds());
      if (liveVehicle) {
        bounds.extend([liveVehicle.currentLocation.lat, liveVehicle.currentLocation.lng]);
      }
      this.map.flyToBounds(bounds, { padding: [45, 45], maxZoom: 16, duration: 0.85 });
    }
    breachMarker.openPopup();
    if (vehicleMarker) {
      window.setTimeout(() => vehicleMarker.openPopup(), 250);
    }
  }

  private clearGeofenceLayers(): void {
    if (!this.map) {
      return;
    }
    if (this.geofenceRouteLayer) {
      this.map.removeLayer(this.geofenceRouteLayer);
      this.geofenceRouteLayer = undefined;
    }
    if (this.geofenceCircleLayer) {
      this.map.removeLayer(this.geofenceCircleLayer);
      this.geofenceCircleLayer = undefined;
    }
    if (this.geofenceBreachMarker) {
      this.map.removeLayer(this.geofenceBreachMarker);
      this.geofenceBreachMarker = undefined;
    }
    if (this.geofenceVehicleMarker) {
      this.map.removeLayer(this.geofenceVehicleMarker);
      this.geofenceVehicleMarker = undefined;
    }
  }

  closeGeofenceToast(vehicleId: string): void {
    const remaining = this.geofenceBreaches.filter((item) => item.vehicleId !== vehicleId);
    this.geofenceBreaches = remaining;

    if (this.selectedGeofenceVehicleId !== vehicleId) {
      return;
    }

    if (remaining.length) {
      this.showGeofenceDetails(remaining[0]);
      return;
    }

    this.selectedGeofenceVehicleId = null;
    this.clearGeofenceLayers();
  }

  trackByGeofenceBreach(_index: number, breach: GeofenceBreach): string {
    return breach.vehicleId;
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
      this.isStarting ||
      this.isStopping ||
      this.isInjectingIncident ||
      this.isApplyingRoute ||
      this.isResettingFresh
    ) {
      return;
    }

    this.setResettingFresh(true);
    this.clearMessages();

    try {
      if (this.isResolveModalOpen) {
        this.closeResolveModal();
      }
      if (this.isVehicleOverviewModalOpen) {
        this.closeVehicleOverviewModal();
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
            this.setResettingFresh(false);
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
    } catch (_error) {
      this.setResettingFresh(false);
      this.errorMessage = 'Failed to reset and initialize fresh state.';
    }
  }

  private setResettingFresh(value: boolean): void {
    if (NgZone.isInAngularZone()) {
      this.isResettingFresh = value;
      return;
    }
    this.ngZone.run(() => {
      this.isResettingFresh = value;
    });
  }

  private setInitializing(value: boolean): void {
    if (NgZone.isInAngularZone()) {
      this.isInitializing = value;
      return;
    }
    this.ngZone.run(() => {
      this.isInitializing = value;
    });
  }

  private setStarting(value: boolean): void {
    if (NgZone.isInAngularZone()) {
      this.isStarting = value;
      return;
    }
    this.ngZone.run(() => {
      this.isStarting = value;
    });
  }

  private setStopping(value: boolean): void {
    if (NgZone.isInAngularZone()) {
      this.isStopping = value;
      return;
    }
    this.ngZone.run(() => {
      this.isStopping = value;
    });
  }

  private setApplyingRoute(value: boolean): void {
    if (NgZone.isInAngularZone()) {
      this.isApplyingRoute = value;
      return;
    }
    this.ngZone.run(() => {
      this.isApplyingRoute = value;
    });
  }

  private clearApplyRouteWatchdog(): void {
    if (!this.applyRouteWatchdogTimer) {
      return;
    }
    window.clearTimeout(this.applyRouteWatchdogTimer);
    this.applyRouteWatchdogTimer = undefined;
  }

  private runInUiContext(callback: () => void): void {
    const execute = () => {
      callback();
      try {
        this.cdr.detectChanges();
      } catch (_error) {
        // no-op: detectChanges can throw if view is already destroyed.
      }
    };

    if (NgZone.isInAngularZone()) {
      execute();
      return;
    }
    this.ngZone.run(() => {
      execute();
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

    this.geofenceBreachSub = this.fleetLive.geofenceBreaches$().subscribe((breach) => {
      this.handleGeofenceBreachEvent(breach);
    });

    this.geofenceClearSub = this.fleetLive.geofenceClears$().subscribe((vehicleId) => {
      this.handleGeofenceClearEvent(vehicleId);
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
    this.syncResolvePreviewVehicleWithLiveData(updatedVehicles);
  }

  private syncResolvePreviewVehicleWithLiveData(updatedVehicles: Vehicle[]): void {
    if (!this.isResolveModalOpen || !this.resolvePreview?.vehicle) {
      return;
    }

    const targetVehicleId = this.resolvePreview.vehicle.vehicleId;
    const latestVehicle =
      updatedVehicles.find((vehicle) => vehicle.vehicleId === targetVehicleId) ||
      this.vehicles.find((vehicle) => vehicle.vehicleId === targetVehicleId);

    if (!latestVehicle) {
      return;
    }

    this.resolvePreview = {
      ...this.resolvePreview,
      vehicle: {
        ...this.resolvePreview.vehicle,
        currentLocation: latestVehicle.currentLocation,
        status: latestVehicle.status,
        speedKmh: latestVehicle.speedKmh,
        lastUpdated: latestVehicle.lastUpdated
      }
    };

    if (this.resolveVehicleMarker) {
      this.resolveVehicleMarker.setLatLng([latestVehicle.currentLocation.lat, latestVehicle.currentLocation.lng]);
      this.resolveVehicleMarker.setPopupContent(`<b>${targetVehicleId}</b><br/>Current Position`);
    }
  }

  private shouldKeepExistingVehicle(existing: Vehicle, incoming: Vehicle): boolean {
    const existingTimestamp = this.getTimestamp(existing.lastUpdated);
    const incomingTimestamp = this.getTimestamp(incoming.lastUpdated);

    if (existingTimestamp !== null && incomingTimestamp !== null && existingTimestamp > incomingTimestamp) {
      return true;
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

  private isVehicleBetweenSourceAndDestination(vehicle: Vehicle): boolean {
    if (vehicle.status === 'reached') {
      return false;
    }

    const source = vehicle.source;
    const destination = vehicle.destination;
    const current = vehicle.currentLocation;

    const routeDistanceMeters = this.getDistanceMeters(source, destination);
    if (routeDistanceMeters < 20) {
      return false;
    }

    const distanceFromSourceMeters = this.getDistanceMeters(source, current);
    const distanceToDestinationMeters = this.getDistanceMeters(current, destination);

    // Ensure the vehicle is in transit between endpoints and not parked at either end.
    const endpointPaddingMeters = Math.min(60, routeDistanceMeters * 0.05);
    if (distanceFromSourceMeters <= endpointPaddingMeters || distanceToDestinationMeters <= endpointPaddingMeters) {
      return false;
    }

    // Allow route curvature/noise but keep position on the source-destination trip window.
    const maxPathStretch = 1.45;
    const traveledPathMeters = distanceFromSourceMeters + distanceToDestinationMeters;
    return traveledPathMeters <= routeDistanceMeters * maxPathStretch;
  }

  private getDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const earthRadiusMeters = 6371000;
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLat = lat2 - lat1;
    const dLng = toRadians(b.lng - a.lng);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const haversine =
      sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private getVehicleIdHintFromIncidentReason(reason: string): string | undefined {
    const match = String(reason || '').match(/Block near ([A-Za-z0-9-]+)/);
    return match ? match[1] : undefined;
  }

  private renderVehiclesOnMap(): void {
    if (!this.map) {
      return;
    }

    const vehiclesToRender = this.selectedVehicleId
      ? this.vehicles.filter((vehicle) => vehicle.vehicleId === this.selectedVehicleId)
      : this.vehicles;
    const activeIds = new Set(vehiclesToRender.map((vehicle) => vehicle.vehicleId));
    const knownVehicleIds = new Set(this.vehicles.map((vehicle) => vehicle.vehicleId));

    this.removeInactiveLayers(this.markers, activeIds);
    this.removeInactiveLayers(this.sourceMarkers, activeIds);
    this.removeInactiveLayers(this.destinationMarkers, activeIds);
    this.removeInactiveLayers(this.routeLines, activeIds);
    this.removeInactiveLayers(this.routeCompletedLines, activeIds);
    this.removeInactivePrimaryRouteCache(knownVehicleIds);

    for (const vehicle of vehiclesToRender) {
      const markerColor = this.getMarkerColor(vehicle.status);
      const markerHtml = this.getVehicleIconSvg(markerColor);
      const icon = L.divIcon({
        className: 'fleet-marker-container',
        html: markerHtml,
        iconSize: [36, 32],
        iconAnchor: [18, 16]
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
        const routeSignature = this.getPrimaryMapRouteSignature(vehicle);
        const cachedRoutePoints =
          this.primaryMapRouteSignatures.get(vehicle.vehicleId) === routeSignature
            ? this.primaryMapRoutePoints.get(vehicle.vehicleId)
            : undefined;
        const points: Array<[number, number]> =
          cachedRoutePoints && cachedRoutePoints.length > 1
            ? cachedRoutePoints
            : [
                [vehicle.source.lat, vehicle.source.lng] as [number, number],
                [vehicle.currentLocation.lat, vehicle.currentLocation.lng] as [number, number],
                [vehicle.destination.lat, vehicle.destination.lng] as [number, number]
              ];

        this.upsertProgressRouteLines(vehicle.vehicleId, points, vehicle.currentLocation);

        this.ensurePrimaryMapRoadRoute(vehicle, routeSignature);
      }
    }

    if (this.selectedVehicleId && vehiclesToRender.length === 1) {
      const selectedVehicle = vehiclesToRender[0];
      const remainingLine = this.routeLines.get(selectedVehicle.vehicleId);
      if (remainingLine && this.map) {
        this.map.removeLayer(remainingLine);
        this.routeLines.delete(selectedVehicle.vehicleId);
      }
      const completedLine = this.routeCompletedLines.get(selectedVehicle.vehicleId);
      if (completedLine && this.map) {
        this.map.removeLayer(completedLine);
        this.routeCompletedLines.delete(selectedVehicle.vehicleId);
      }

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
    return this.fetchRoadRouteBetween(vehicle.currentLocation, vehicle.destination);
  }

  private async fetchRoadRouteBetween(
    sourcePoint: { lat: number; lng: number },
    destinationPoint: { lat: number; lng: number }
  ): Promise<Array<[number, number]>> {
    const source = `${sourcePoint.lng},${sourcePoint.lat}`;
    const destination = `${destinationPoint.lng},${destinationPoint.lat}`;
    const routePath = `/route/v1/driving/${source};${destination}?overview=full&geometries=geojson`;
    const osrmUrls = this.getOsrmRouteUrls(routePath);
    let lastError: unknown = null;

    for (const url of osrmUrls) {
      try {
        const data = await this.fetchOsrmRoute(url);
        const coordinates: Array<[number, number]> | undefined = data?.routes?.[0]?.geometry?.coordinates;
        if (!coordinates?.length) {
          throw new Error('OSRM route response has no coordinates');
        }
        return coordinates.map(([lng, lat]) => [lat, lng]);
      } catch (error) {
        lastError = error;
        console.warn(`[FleetManagement] OSRM route fetch failed for ${url}`, error);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('OSRM route request failed for both local and public endpoints');
  }

  private removeInactivePrimaryRouteCache(activeIds: Set<string>): void {
    for (const vehicleId of Array.from(this.primaryMapRoutePoints.keys())) {
      if (!activeIds.has(vehicleId)) {
        this.primaryMapRoutePoints.delete(vehicleId);
        this.primaryMapRouteSignatures.delete(vehicleId);
        this.primaryMapRouteRequests.delete(vehicleId);
      }
    }
  }

  private upsertProgressRouteLines(
    vehicleId: string,
    routePoints: Array<[number, number]>,
    currentLocation: { lat: number; lng: number }
  ): void {
    if (!this.map || routePoints.length < 2) {
      return;
    }

    const { completedPoints, remainingPoints } = this.splitRouteByCurrentLocation(routePoints, currentLocation);
    const completedStyle = { color: '#333', weight: 3, opacity: 0.95 };
    const remainingStyle = { color: '#2563eb', weight: 3, opacity: 0.9 };

    const completedLine = this.routeCompletedLines.get(vehicleId);
    if (completedPoints.length > 1) {
      if (completedLine) {
        completedLine.setLatLngs(completedPoints);
      } else {
        this.routeCompletedLines.set(vehicleId, L.polyline(completedPoints, completedStyle).addTo(this.map));
      }
    } else if (completedLine) {
      this.map.removeLayer(completedLine);
      this.routeCompletedLines.delete(vehicleId);
    }

    const remainingLine = this.routeLines.get(vehicleId);
    if (remainingPoints.length > 1) {
      if (remainingLine) {
        remainingLine.setLatLngs(remainingPoints);
      } else {
        this.routeLines.set(vehicleId, L.polyline(remainingPoints, remainingStyle).addTo(this.map));
      }
    } else if (remainingLine) {
      this.map.removeLayer(remainingLine);
      this.routeLines.delete(vehicleId);
    }
  }

  private splitRouteByCurrentLocation(
    routePoints: Array<[number, number]>,
    currentLocation: { lat: number; lng: number }
  ): { completedPoints: Array<[number, number]>; remainingPoints: Array<[number, number]> } {
    if (routePoints.length < 2) {
      return { completedPoints: routePoints, remainingPoints: routePoints };
    }

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < routePoints.length; index += 1) {
      const [lat, lng] = routePoints[index];
      const distance = this.getDistanceMeters({ lat, lng }, currentLocation);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    const currentPoint: [number, number] = [currentLocation.lat, currentLocation.lng];
    const completedPoints = routePoints.slice(0, Math.max(closestIndex + 1, 1));
    if (!this.isSameRoutePoint(completedPoints[completedPoints.length - 1], currentPoint)) {
      completedPoints.push(currentPoint);
    }

    let remainingPoints = routePoints.slice(Math.max(closestIndex, 0));
    if (!remainingPoints.length) {
      remainingPoints = [currentPoint];
    } else if (!this.isSameRoutePoint(remainingPoints[0], currentPoint)) {
      remainingPoints = [currentPoint, ...remainingPoints];
    }

    return { completedPoints, remainingPoints };
  }

  private isSameRoutePoint(a: [number, number], b: [number, number], epsilon = 0.00001): boolean {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
  }

  private getPrimaryMapRouteSignature(vehicle: Vehicle): string {
    return `${vehicle.source.lat.toFixed(5)},${vehicle.source.lng.toFixed(5)}|${vehicle.destination.lat.toFixed(5)},${vehicle.destination.lng.toFixed(5)}`;
  }

  private ensurePrimaryMapRoadRoute(vehicle: Vehicle, routeSignature: string): void {
    if (this.primaryMapRouteRequests.has(vehicle.vehicleId)) {
      return;
    }
    if (
      this.primaryMapRouteSignatures.get(vehicle.vehicleId) === routeSignature &&
      (this.primaryMapRoutePoints.get(vehicle.vehicleId)?.length || 0) > 1
    ) {
      return;
    }

    this.primaryMapRouteRequests.add(vehicle.vehicleId);
    this.fetchRoadRouteBetween(vehicle.source, vehicle.destination)
      .then((routePoints) => {
        if (this.getPrimaryMapRouteSignature(vehicle) !== routeSignature) {
          return;
        }
        this.primaryMapRoutePoints.set(vehicle.vehicleId, routePoints);
        this.primaryMapRouteSignatures.set(vehicle.vehicleId, routeSignature);
        const latestVehicle = this.vehicles.find((item) => item.vehicleId === vehicle.vehicleId) || vehicle;
        this.upsertProgressRouteLines(vehicle.vehicleId, routePoints, latestVehicle.currentLocation);
      })
      .catch((error) => {
        console.warn(`[FleetManagement] primary map road route unavailable for ${vehicle.vehicleId}`, error);
      })
      .finally(() => {
        this.primaryMapRouteRequests.delete(vehicle.vehicleId);
      });
  }

  private getOsrmRouteUrls(routePath: string): string[] {
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    const localUrl = `http://${host}:5001${routePath}`;
    const publicUrl = `https://router.project-osrm.org${routePath}`;
    if (localUrl === publicUrl) {
      return [publicUrl];
    }
    return [localUrl, publicUrl];
  }

  private async fetchOsrmRoute(url: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`OSRM route request failed with status ${response.status}`);
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeoutId);
    }
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

  private getIncidentBlockIcon(): any {
    return L.divIcon({
      className: 'incident-block-pin',
      html:
        '<div style="width:24px;height:24px;border-radius:50%;background:#dc2626;border:2px solid #ffffff;box-shadow:0 0 0 1px #7f1d1d;position:relative;"><div style="position:absolute;left:4px;top:9px;width:12px;height:4px;background:#ffffff;border-radius:2px;"></div></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  private getGeofenceBreachIcon(): any {
    return L.divIcon({
      className: 'geofence-breach-pin',
      html:
        '<div style="width:26px;height:26px;border-radius:50%;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:2px solid #fff;box-shadow:0 0 0 2px rgba(127,29,29,0.45);">!</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  private getGeofenceVehicleIcon(): any {
    return L.divIcon({
      className: 'geofence-vehicle-pin',
      html:
        '<div style="width:24px;height:24px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 0 0 2px rgba(15,23,42,0.2);">V</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  private getVehicleIconSvg(color: string): string {
    const trailerColor = color || '#2563eb';
    const cabColor = '#0f172a';
    const windowColor = '#bfdbfe';
    const stripeColor = '#fbbf24';
    const wheelColor = '#111827';
    const outlineColor = '#0b1220';

    return `
      <svg
        class="map-vehicle-icon"
        width="36"
        height="32"
        viewBox="0 0 36 32"
        role="presentation"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="2.5" y="11" width="19" height="10" rx="3" fill="${trailerColor}" stroke="${outlineColor}" stroke-width="1" />
        <rect x="21" y="10.5" width="11" height="11.5" rx="2.2" fill="${cabColor}" stroke="${outlineColor}" stroke-width="1" />
        <rect x="23" y="13.5" width="7" height="5" rx="1.2" fill="${windowColor}" stroke="rgba(255, 255, 255, 0.6)" stroke-width="0.6" />
        <rect x="23" y="19.8" width="7" height="2.5" rx="1" fill="${stripeColor}" />
        <path d="M5 15.5h12" stroke="rgba(255,255,255,0.45)" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="8.5" cy="25.2" r="3.3" fill="${wheelColor}" stroke="#080c13" stroke-width="0.9" />
        <circle cx="25" cy="25.2" r="3.3" fill="${wheelColor}" stroke="#080c13" stroke-width="0.9" />
        <circle cx="19.5" cy="25.2" r="3.3" fill="${wheelColor}" stroke="#080c13" stroke-width="0.9" />
      </svg>
    `;
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
    const alternateWaypoint2 = {
      lat: midpoint.lat - 0.0036,
      lng: midpoint.lng + 0.0034
    };
    const alternateRoutePoints = [fallbackVehicle.currentLocation, alternateWaypoint, fallbackVehicle.destination];
    const alternateRoutePoints2 = [fallbackVehicle.currentLocation, alternateWaypoint2, fallbackVehicle.destination];

    return {
      incident,
      vehicle: fallbackVehicle,
      currentRoutePoints,
      alternateRoutePoints,
      alternateRouteOptions: [
        { routeId: 'alt-1', label: 'Alternate Route 1', routePoints: alternateRoutePoints },
        { routeId: 'alt-2', label: 'Alternate Route 2', routePoints: alternateRoutePoints2 }
      ],
      proposedDestination: fallbackVehicle.destination,
      heatmapPoints: this.heatmapPoints
    };
  }
}
