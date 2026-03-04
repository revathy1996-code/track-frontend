import { Component } from '@angular/core';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  standalone: false
})
export class SidebarComponent {
  protected isCollapsed = true;

  protected toggleSidebar(): void {
    this.isCollapsed = !this.isCollapsed;
  }
}
