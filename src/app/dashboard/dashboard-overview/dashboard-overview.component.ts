import { Component } from '@angular/core';

type OverviewCard = {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
};

type AlertItem = {
  title: string;
  details: string;
};

type ActivityItem = {
  time: string;
  activity: string;
  detail: string;
  status: string;
};

type RevenueBar = {
  label: string;
  value: number;
};

@Component({
  selector: 'app-dashboard-overview',
  templateUrl: './dashboard-overview.component.html',
  standalone: false
})
export class DashboardOverviewComponent {
  protected readonly today = new Date('2025-02-10');

  protected readonly summaryCards: OverviewCard[] = [
    { label: 'Total Shipments', value: '7000', delta: '+14.9%', trend: 'up' },
    { label: 'Active Vehicles', value: '900', delta: '+14.9%', trend: 'up' },
    { label: 'Warehouse Capacity', value: '48%', delta: '+4.9%', trend: 'down' },
    { label: 'Earnings & Costs', value: 'INR 3,05,000', delta: '+14.9%', trend: 'up' }
  ];

  protected readonly alerts: AlertItem[] = [
    {
      title: 'Urgent: Shipment Delay Alert!',
      details: 'Order #56789 is delayed due to unforeseen circumstances. Expected arrival: +2 days.'
    },
    {
      title: 'Inventory Alert: Low Stock!',
      details: 'Product SKU: 4532A is below the minimum threshold. Only 12 units left in Warehouse #5.'
    },
    {
      title: 'Upcoming Maintenance Due',
      details: 'Vehicle #TX-9087 needs engine servicing in 5 days. Schedule maintenance to avoid breakdowns.'
    },
    {
      title: 'Critical Stockout Warning!',
      details: 'Essential supplies (Pallet #A89) are out of stock. Reorder immediately to prevent delays.'
    }
  ];

  protected readonly activities: ActivityItem[] = [
    {
      time: 'Feb 10, 2025, 10:15 AM',
      activity: 'New Order Placed',
      detail: 'Order #98765 (Electronics) confirmed for shipping',
      status: 'Confirmed'
    },
    {
      time: 'Feb 10, 2025, 09:45 AM',
      activity: 'Shipment Dispatched',
      detail: 'Order #56789 left Warehouse #3 for delivery',
      status: 'In Transit'
    },
    {
      time: 'Feb 09, 2025, 06:20 PM',
      activity: 'Inventory Updated',
      detail: 'SKU #4532A restocked by 250 units',
      status: 'Updated'
    }
  ];

  protected readonly revenueBars: RevenueBar[] = [
    { label: '10 Jan', value: 36 },
    { label: '15 Jan', value: 22 },
    { label: '20 Jan', value: 45 },
    { label: '25 Jan', value: 64 },
    { label: '30 Jan', value: 41 }
  ];
}
