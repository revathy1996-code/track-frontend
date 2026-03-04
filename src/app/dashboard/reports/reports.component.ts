import { Component, OnInit } from '@angular/core';
import {
  AnalyticsSummary,
  PerformanceAnalyticsResponse,
  VehicleAnalytics
} from '../../core/models/fleet.models';
import { FleetApiService } from '../../core/services/fleet-api.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  standalone: false
})
export class ReportsComponent implements OnInit {
  summary?: AnalyticsSummary;
  vehicleBreakdown: VehicleAnalytics[] = [];
  recentReroutes: PerformanceAnalyticsResponse['recentReroutes'] = [];
  errorMessage = '';

  constructor(private readonly fleetApi: FleetApiService) {}

  ngOnInit(): void {
    this.loadAnalytics();
  }

  trackByVehicle(_index: number, item: VehicleAnalytics): string {
    return item.vehicleId;
  }

  trackByReroute(_index: number, item: PerformanceAnalyticsResponse['recentReroutes'][number]): string {
    return `${item.vehicleId}-${item.timestamp}`;
  }

  private loadAnalytics(): void {
    this.fleetApi.getAnalyticsSummary().subscribe({
      next: (response) => {
        this.summary = response.summary;
        this.vehicleBreakdown = response.vehicleBreakdown;
        this.recentReroutes = response.recentReroutes;
      },
      error: () => {
        this.errorMessage = 'Unable to load performance analytics.';
      }
    });
  }
}
