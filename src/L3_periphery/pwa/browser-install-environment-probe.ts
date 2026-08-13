import { Injectable } from '@angular/core';

import {
  InstallEnvironmentProbe,
  InstallPlatform,
} from '../../L1_domain/ports/install-environment-probe';

// Regex de webviews conocidos que embeben una WebView y NO permiten agregar
// a home screen. La lista es representativa (no exhaustiva) — cubre las
// apps donde nuestros alumnos suelen abrir links compartidos.
const WEBVIEW_UA_RE =
  /(fban|fbav|instagram|tiktok|line\/|micromessenger|gmailapp|wechat|whatsapp|snapchat|twitter)/i;

// Regex para iOS Safari genuino: contiene "Safari/" y NO otro browser iOS
// (CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS = Edge iOS). Todos los
// browsers iOS no-Safari son WebKit por dentro pero no pueden agregar a home.
const IOS_SAFARI_UA_RE = /safari\//i;
const IOS_OTHER_BROWSER_UA_RE = /(crios|fxios|edgios)/i;

// Chromium en Android que dispara `beforeinstallprompt`: Chrome, Edge, Samsung
// Internet, Brave, Opera. Firefox Android usa Gecko y NO dispara el evento.
const ANDROID_CHROMIUM_UA_RE = /(chrome|crios|edge|edga|edgw|samsungbrowser|opr\/|opera)/i;
const ANDROID_FIREFOX_UA_RE = /(firefox|fennec)/i;

@Injectable({ providedIn: 'root' })
export class BrowserInstallEnvironmentProbe implements InstallEnvironmentProbe {
  isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      // Chrome/Edge/Firefox/Chromium desktop: display-mode: standalone cuando
      // se abre desde el icono instalado.
      if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    } catch {
      // matchMedia puede tirar en entornos exóticos; degradamos a `false`.
    }
    // iOS Safari expone `navigator.standalone` (no-standard, solo Apple).
    // Es la única forma de detectar "agregada a home" en iOS.
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
    return iosStandalone === true;
  }

  isMobileFormFactor(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const noHover = window.matchMedia('(hover: none)').matches;
      // Combinación: coarse pointer (dedo, no mouse) + hover ausente. Un
      // Surface con teclado desconectado también pasaría — aceptable, no
      // hace daño ofrecer el card ahí.
      return coarsePointer && noHover;
    } catch {
      return false;
    }
  }

  getPlatform(): InstallPlatform {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent ?? '';
    if (ua.length === 0) return 'unknown';

    // Webviews van primero: pueden tener userAgent que aparenta ser Chrome
    // pero corren adentro de Instagram/TikTok/etc. y no pueden instalar.
    if (WEBVIEW_UA_RE.test(ua)) return 'webview';

    const isIos =
      /iphone|ipad|ipod/i.test(ua) &&
      (window as unknown as { MSStream?: unknown }).MSStream === undefined;
    if (isIos) {
      // iOS: si tiene marker de otro browser (CriOS/FxiOS/EdgiOS) es no-Safari.
      // Si tiene "Safari/" y no tiene marker de otro → Safari genuino.
      if (IOS_OTHER_BROWSER_UA_RE.test(ua)) return 'iosOther';
      return IOS_SAFARI_UA_RE.test(ua) ? 'iosSafari' : 'iosOther';
    }

    if (/android/i.test(ua)) {
      if (ANDROID_FIREFOX_UA_RE.test(ua)) return 'androidOther';
      return ANDROID_CHROMIUM_UA_RE.test(ua) ? 'androidChromium' : 'androidOther';
    }

    // Sin marker mobile en UA: casi seguro desktop. Si además pointer es fino
    // (mouse) confirmamos. Si mobile UA falla pero pointer es coarse, quedará
    // como desktop — falso negativo aceptable (peor caso: no ofrecemos install
    // en un dispositivo raro con UA mentiroso).
    return 'desktop';
  }
}
