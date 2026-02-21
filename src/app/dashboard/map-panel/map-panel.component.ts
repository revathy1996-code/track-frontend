import { AfterViewInit, Component, OnDestroy } from '@angular/core';

declare const L: any;

@Component({
  selector: 'app-map-panel',
  templateUrl: './map-panel.component.html',
  standalone: false
})
export class MapPanelComponent implements AfterViewInit, OnDestroy {
  private map?: any;

  ngAfterViewInit(): void {
    if (typeof L === 'undefined') {
      return;
    }

    this.map = L.map('map-canvas', { zoomControl: true }).setView([12.972, 77.594], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    const route = [
      [12.9768, 77.5993],
      [12.9739, 77.6042],
      [12.9704, 77.6088],
      [12.9658, 77.6072],
      [12.9612, 77.6023],
      [12.964, 77.5958],
      [12.9692, 77.5915],
      [12.9735, 77.5939],
      [12.9768, 77.5993]
    ];

    L.polyline(route, { color: '#2268f6', weight: 4, opacity: 0.85 }).addTo(this.map);

    for (const point of route) {
      L.circleMarker(point as [number, number], {
        radius: 5,
        color: '#1b4cc0',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 2
      }).addTo(this.map);
    }

    L.marker([12.9695, 77.5989]).addTo(this.map).bindPopup(
      '<b>Vehicle Details</b><br/>Driver: John Doe<br/>Vehicle: ABX-1234<br/>Status: Enroute'
    );
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
  }
}
