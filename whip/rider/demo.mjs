import { attachWhipBooking } from '../../js/travel/whip-booking.mjs';
attachWhipBooking({ panel: document.querySelector('#demoEntry') });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
