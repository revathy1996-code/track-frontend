import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { DashboardComponent } from './dashboard/dashboard.component';
import { SidebarComponent } from './dashboard/sidebar/sidebar.component';
import { TopbarComponent } from './dashboard/topbar/topbar.component';
import { OverviewCardsComponent } from './dashboard/overview-cards/overview-cards.component';
import { MapPanelComponent } from './dashboard/map-panel/map-panel.component';
import { AlertsPanelComponent } from './dashboard/alerts-panel/alerts-panel.component';
import { ActivitiesTableComponent } from './dashboard/activities-table/activities-table.component';
import { RevenuePanelComponent } from './dashboard/revenue-panel/revenue-panel.component';
import { DashboardOverviewComponent } from './dashboard/dashboard-overview/dashboard-overview.component';
import { ShipmentsComponent } from './dashboard/shipments/shipments.component';
import { FleetManagementComponent } from './dashboard/fleet-management/fleet-management.component';
import { WarehouseComponent } from './dashboard/warehouse/warehouse.component';
import { ReportsComponent } from './dashboard/reports/reports.component';

@NgModule({
  declarations: [
    App,
    DashboardComponent,
    SidebarComponent,
    TopbarComponent,
    OverviewCardsComponent,
    MapPanelComponent,
    AlertsPanelComponent,
    ActivitiesTableComponent,
    RevenuePanelComponent,
    DashboardOverviewComponent,
    ShipmentsComponent,
    FleetManagementComponent,
    WarehouseComponent,
    ReportsComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    AppRoutingModule
  ],
  providers: [
    provideBrowserGlobalErrorListeners(),
  ],
  bootstrap: [App]
})
export class AppModule { }
