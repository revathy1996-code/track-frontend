
from pathlib import Path

path = Path( src/app/dashboard/fleet-management/fleet-management.component.ts)
text = path.read_text()
start = text.index( private getVehicleIconSvg)
end = text.index( private buildLocalResolvePreview, start)

lines = [
