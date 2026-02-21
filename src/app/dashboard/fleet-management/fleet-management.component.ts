import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { FleetApiService } from '../../core/services/fleet-api.service';
import { Vehicle } from '../../core/models/fleet.models';
import { HttpErrorResponse } from '@angular/common/http';
import { FleetLiveService } from '../../core/services/fleet-live.service';

declare const L: any;

@Component({
  selector: 'app-fleet-management',
  templateUrl: './fleet-management.component.html',
  standalone: false
})
export class FleetManagementComponent implements OnInit, AfterViewInit, OnDestroy {
  vehicles: Vehicle[] = [];
  isSimulationRunning = false;
  isInitializing = false;
  isStarting = false;
  isStopping = false;
  message = '';
  errorMessage = '';
  selectedVehicleId: string | null = null;
  isLoadingSelectedRoute = false;

  private map?: any;
  private markers = new Map<string, any>();
  private sourceMarkers = new Map<string, any>();
  private destinationMarkers = new Map<string, any>();
  private routeLines = new Map<string, any>();
  private selectedRouteLine?: any;
  private selectedRoutePoints = new Map<string, Array<[number, number]>>();
  private routeZoomedVehicleId: string | null = null;
  private statusSub?: Subscription;
  private updateSub?: Subscription;

  constructor(
    private readonly fleetApi: FleetApiService,
    private readonly fleetLive: FleetLiveService
  ) {}

  ngOnInit(): void {
    this.loadVehicles();
    this.loadSimulationStatus();
    this.initLiveUpdates();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
    this.updateSub?.unsubscribe();
    this.fleetLive.disconnect();
    if (this.map) {
      this.map.remove();
    }
  }

  initMockVehicles(): void {
    this.isInitializing = true;
    this.clearMessages();

    this.fleetApi.initMockVehicles().subscribe({
      next: (response) => {
        console.log('[FleetManagement] initMockVehicles response:', response);
        this.isInitializing = false;
        this.message = `${response.count} mock vehicles initialized.`;
        this.loadVehicles();
        this.loadSimulationStatus();
      },
      error: () => {
        this.isInitializing = false;
        this.errorMessage = 'Failed to initialize mock vehicles.';
      }
    });
  }

  startSimulation(): void {
    this.isStarting = true;
    this.clearMessages();

    this.fleetApi.startSimulation().subscribe({
      next: (response) => {
        console.log('[FleetManagement] startSimulation response:', response);
        this.isStarting = false;
        if (!response.started) {
          this.errorMessage = response.reason || 'Unable to start simulation.';
          return;
        }

        this.message = 'Simulation started.';
        this.isSimulationRunning = true;
      },
      error: (error: HttpErrorResponse) => {
        console.error('[FleetManagement] startSimulation error:', error);
        this.isStarting = false;
        this.errorMessage = error.error?.reason || error.error?.message || 'Failed to start simulation.';

        if (error.error?.reason === 'Simulation already running.') {
          this.isSimulationRunning = true;
        }
      }
    });
  }

  stopSimulation(): void {
    this.isStopping = true;
    this.clearMessages();

    this.fleetApi.stopSimulation().subscribe({
      next: () => {
        console.log('[FleetManagement] stopSimulation response: success');
        this.isStopping = false;
        this.message = 'Simulation stopped.';
        this.isSimulationRunning = false;
        this.loadVehicles();
      },
      error: () => {
        this.isStopping = false;
        this.errorMessage = 'Failed to stop simulation.';
      }
    });
  }

  trackByVehicle(_index: number, vehicle: Vehicle): string {
    return vehicle.vehicleId;
  }

  get isAnalyzingVehicle(): boolean {
    return Boolean(this.selectedVehicleId);
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
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }

  private loadVehicles(): void {
    this.fleetApi.getVehicles().subscribe({
      next: (response) => {
        this.vehicles = response.data;
        console.log('Loaded vehicles:', this.vehicles);
        this.renderVehiclesOnMap();
      },
      error: () => {
        this.errorMessage = 'Unable to load vehicles from backend.';
      }
    });
  }

  private loadSimulationStatus(): void {
    this.fleetApi.getSimulationStatus().subscribe({
      next: (status) => {
        console.log('[FleetManagement] simulation status:', status);
        this.isSimulationRunning = status.isRunning;
      },
      error: () => {
        this.errorMessage = 'Unable to load simulation status.';
      }
    });
  }

  private initLiveUpdates(): void {
    this.fleetLive.connect();

    this.statusSub = this.fleetLive.simulationStatus$().subscribe((status) => {
      console.log('[FleetManagement] socket status update:', status);
      this.isSimulationRunning = status.isRunning;
    });

    this.updateSub = this.fleetLive.simulationUpdates$().subscribe((vehicles) => {
      console.log('[FleetManagement] socket vehicle update:', vehicles);
      this.upsertVehicles(vehicles);
    });
  }

  private upsertVehicles(updatedVehicles: Vehicle[]): void {
    const byVehicleId = new Map(this.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle]));
    for (const vehicle of updatedVehicles) {
      byVehicleId.set(vehicle.vehicleId, vehicle);
    }

    this.vehicles = Array.from(byVehicleId.values()).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    this.renderVehiclesOnMap();
  }

  private renderVehiclesOnMap(): void {
    if (!this.map) {
      return;
    }

    const vehiclesToRender = this.selectedVehicleId
      ? this.vehicles.filter((vehicle) => vehicle.vehicleId === this.selectedVehicleId)
      : this.vehicles;
    const activeIds = new Set(vehiclesToRender.map((vehicle) => vehicle.vehicleId));

    for (const [vehicleId, marker] of this.markers.entries()) {
      if (!activeIds.has(vehicleId)) {
        this.map.removeLayer(marker);
        this.markers.delete(vehicleId);
      }
    }
    for (const [vehicleId, marker] of this.sourceMarkers.entries()) {
      if (!activeIds.has(vehicleId)) {
        this.map.removeLayer(marker);
        this.sourceMarkers.delete(vehicleId);
      }
    }
    for (const [vehicleId, marker] of this.destinationMarkers.entries()) {
      if (!activeIds.has(vehicleId)) {
        this.map.removeLayer(marker);
        this.destinationMarkers.delete(vehicleId);
      }
    }

    for (const [vehicleId, line] of this.routeLines.entries()) {
      if (!activeIds.has(vehicleId)) {
        this.map.removeLayer(line);
        this.routeLines.delete(vehicleId);
      }
    }

    for (const vehicle of vehiclesToRender) {
      const markerColor = this.getMarkerColor(vehicle.status);
      const markerHtml = this.getVehicleIconSvg(markerColor);

      const icon = L.divIcon({
        className: 'fleet-marker',
        html: markerHtml,
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      const popup = `<b>${vehicle.vehicleId}</b><br/>${vehicle.name}<br/>Status: ${vehicle.status}<br/>Speed: ${vehicle.speedKmh} km/h`;
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
            [selectedVehicle.source.lat, selectedVehicle.source.lng],
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

  private async ensureVehicleRoadRoute(vehicle: Vehicle): Promise<void> {
    if (this.selectedRoutePoints.has(vehicle.vehicleId)) {
      return;
    }

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
    const source = `${vehicle.source.lng},${vehicle.source.lat}`;
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
}
