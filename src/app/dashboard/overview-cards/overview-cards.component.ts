import { Component, Input } from '@angular/core';

type OverviewCard = {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
};

@Component({
  selector: 'app-overview-cards',
  templateUrl: './overview-cards.component.html',
  standalone: false
})
export class OverviewCardsComponent {
  @Input() cards: OverviewCard[] = [];
}
