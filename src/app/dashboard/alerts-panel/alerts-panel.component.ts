import { Component, Input } from '@angular/core';

type AlertItem = {
  title: string;
  details: string;
};

@Component({
  selector: 'app-alerts-panel',
  templateUrl: './alerts-panel.component.html',
  standalone: false
})
export class AlertsPanelComponent {
  @Input() alerts: AlertItem[] = [];
}
