import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let cachedIconPath: string | null = null;

export function getAppIconPath(): string {
    if (cachedIconPath && fs.existsSync(cachedIconPath)) {
        return cachedIconPath;
    }

    const isWin = process.platform === 'win32';
    const preferredName = isWin ? 'icon.ico' : 'icon.png';
    const fallbackName = isWin ? 'icon.png' : 'icon.ico';

    const candidateDirs = [
        // 1. static/icons in workspace source (dev mode)
        path.join(__dirname, '../../static/icons'),
        // 2. out/renderer/icons (built output / asar)
        path.join(__dirname, '../renderer/icons'),
        // 3. out/main/icons (if copied alongside main)
        path.join(__dirname, 'icons'),
        // 4. appPath/static/icons (dev electron runner)
        path.join(app.getAppPath(), 'static/icons'),
        // 5. appPath/out/renderer/icons
        path.join(app.getAppPath(), 'out/renderer/icons'),
    ];

    for (const name of [preferredName, fallbackName]) {
        for (const dir of candidateDirs) {
            const fullPath = path.join(dir, name);
            if (fs.existsSync(fullPath)) {
                cachedIconPath = fullPath;
                return fullPath;
            }
        }
    }

    // Default fallback
    return path.join(__dirname, 'icons/icon.png');
}
