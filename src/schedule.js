// Tur zamanlaması. Hem tarayıcı hem Vercel fonksiyonları aynı sabitleri kullanır.
//
// Bir tur: LOBİ (süresiz; oyuncular katılır, hazır oyu verir) → KİLİT (liste sabitlenir, START_DELAY sn geri sayım) →
//          yarış → sonuçlar. Kilit, en az MIN_PLAYERS oyuncu varken HERKES hazırsa ya da RUNNERS (8) oyuncu dolunca atılır.
// Tüm yarış zamanları kilit anından (lock.at, sunucu saati) ölçülür. Boş şeritleri botlar doldurur.
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const nodeEnv = typeof process !== 'undefined' ? process.env : {};
const viteEnv = import.meta.env ?? {};

export const START_DELAY = num(nodeEnv.START_SECONDS ?? viteEnv.VITE_START_SECONDS, 15); // kilitten yarış başlangıcına (son COUNTDOWN sn büyük sayaç)
export const RACE_SECONDS = num(nodeEnv.RACE_SECONDS ?? viteEnv.VITE_RACE_SECONDS, 45);
export const RESULT_SECONDS = num(nodeEnv.RESULT_SECONDS ?? viteEnv.VITE_RESULT_SECONDS, 25);
export const MIN_PLAYERS = 2; // yarışın başlaması için gereken gerçek oyuncu sayısı
export const RUNNERS = 8; // şerit sayısı: gerçek oyuncular + botlar; 8 gerçek oyuncu dolunca tur otomatik başlar
export const COUNTDOWN = 3;
export const FINISH_TAIL = 1.2; // süre bitince koşucuların yavaşlama süresi
export const SETTLE = 3; // yarış bittikten sonra son tuşların sunucuya ulaşması için pay (sn)

// Lobi varlık takibi: oyuncu sekmesi açıkken HEARTBEAT_MS'de bir "buradayım" der; PRESENCE_MS sessiz kalan listeden düşer
export const HEARTBEAT_MS = 6000;
export const PRESENCE_MS = 20000;

// Tuş vuruşları 0,5 sn'lik kovalarda sayılır: ağ yükü küçük kalır, sonuç herkeste aynı hesaplanır.
export const BUCKET = 0.5;
export const MAX_PER_BUCKET = 8;
export const MIN_PRESS_GAP = 0.07; // sn: tuşa basılı tutma / makro koruması

// Kilit anından itibaren, sn
export const RACE_START = START_DELAY;
export const RACE_END = RACE_START + RACE_SECONDS + FINISH_TAIL;
export const ROUND_AFTER = RACE_END + RESULT_SECONDS; // kilitten sonraki turun toplam süresi
