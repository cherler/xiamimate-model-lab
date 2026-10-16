// Reuse the host's real components only when mounted as a host module.
export function onPlatform(location) {
  return ['http:', 'https:'].includes(location.protocol) && location.pathname.startsWith('/model-lab/');
}

export async function mountPlatformChrome() {
  if (!onPlatform(window.location)) return;
  document.documentElement.classList.add('on-platform');
  const header = document.querySelector('#platform-header');
  const footer = document.querySelector('#platform-footer');
  header.hidden = footer.hidden = false;
  const nav = document.querySelector('.lab-topbar');
  const measure = () => {
    document.documentElement.style.setProperty('--platform-header-height', `${header.getBoundingClientRect().height}px`);
    document.documentElement.style.setProperty('--lab-nav-height', `${nav.getBoundingClientRect().height}px`);
  };
  new ResizeObserver(measure).observe(header);
  new ResizeObserver(measure).observe(nav);
  measure();
  try {
    const response = await fetch('/chrome/manifest.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error('Shared chrome unavailable');
    const manifest = await response.json();
    if (manifest.files?.script !== '/chrome/chrome.js' || manifest.files?.css !== '/chrome/chrome.css') throw new Error('Invalid shared chrome manifest');
    await Promise.all([
      new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = '/chrome/chrome.css';
        css.onload = resolve; css.onerror = reject; document.head.append(css);
      }),
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/chrome/chrome.js'; script.onload = resolve; script.onerror = reject;
        document.head.append(script);
      }),
    ]);
    if (!window.XiamiChrome?.header || !window.XiamiChrome?.footer) throw new Error('Shared chrome API unavailable');
    window.XiamiChrome.header('#platform-header', {module: 'model-lab', headerPadding: '0 20px'});
    window.XiamiChrome.footer('#platform-footer', {footerPadding: '26px 30px'});
  } catch {
    // Keep working case navigation and explicit home/contact links when the host is unavailable.
    header.dataset.fallback = 'true';
  }
}

if (typeof window !== 'undefined') void mountPlatformChrome();
