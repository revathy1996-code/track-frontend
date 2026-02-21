import { Component, Input } from '@angular/core';

type ActivityItem = {
  time: string;
  activity: string;
  detail: string;
  status: string;
};

@Component({
  selector: 'app-activities-table',
  templateUrl: './activities-table.component.html',
  standalone: false
})
export class ActivitiesTableComponent {
  @Input() activities: ActivityItem[] = [];
}
