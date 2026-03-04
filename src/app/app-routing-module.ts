import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { DashboardOverviewComponent } from './dashboard/dashboard-overview/dashboard-overview.component';
import { ShipmentsComponent } from './dashboard/shipments/shipments.component';
import { FleetManagementComponent } from './dashboard/fleet-management/fleet-management.component';
import { WarehouseComponent } from './dashboard/warehouse/warehouse.component';
import { ReportsComponent } from './dashboard/reports/reports.component';

const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    children: [
      //{ path: '', component: DashboardOverviewComponent },
      { path: 'shipments', component: ShipmentsComponent },
      { path: '', component: FleetManagementComponent },
      { path: 'warehouse', component: WarehouseComponent },
      { path: 'reports', component: ReportsComponent }
    ]
  },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
