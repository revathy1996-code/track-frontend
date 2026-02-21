import { Component, Input } from '@angular/core';

type RevenueBar = {
  label: string;
  value: number;
};

@Component({
  selector: 'app-revenue-panel',
  templateUrl: './revenue-panel.component.html',
  standalone: false
})
export class RevenuePanelComponent {
  @Input() bars: RevenueBar[] = [];
}
