// Clima atual via Open-Meteo (https://open-meteo.com) — API pública e
// gratuita que não exige cadastro nem chave de API, então não há segredo
// nenhum pra vazar ou revogar aqui (diferente do token do Expo).

export type WeatherNow = {
  tempC: number;
  code: number;
};

export async function fetchWeather(lat: number, lon: number): Promise<WeatherNow | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const cw = json?.current_weather;
    if (!cw || typeof cw.temperature !== 'number') return null;
    return { tempC: Math.round(cw.temperature), code: cw.weathercode ?? 0 };
  } catch {
    return null;
  }
}

export type IpLocation = { lat: number; lon: number; city: string | null };

// Alternativa ao GPS pra descobrir a localização — a maioria das TV box não
// tem GPS/serviços de localização do Google, então `expo-location` nunca
// resolve nelas e o clima nunca aparecia. Isso estima a localização pelo
// IP público (bem menos preciso que GPS — geralmente acerta a cidade, não
// o endereço — mas é o suficiente pra previsão do tempo). Serviço público,
// sem chave de API.
export async function fetchLocationByIp(): Promise<IpLocation | null> {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json?.latitude !== 'number' || typeof json?.longitude !== 'number') return null;
    return { lat: json.latitude, lon: json.longitude, city: json.city || null };
  } catch {
    return null;
  }
}

// Tabela reduzida do "WMO Weather interpretation code" que a Open-Meteo usa,
// mapeada pro ícone do Ionicons mais parecido e uma legenda curta em PT-BR.
export function weatherIcon(code: number): string {
  if (code === 0) return 'sunny';
  if (code <= 2) return 'partly-sunny';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'cloud-outline';
  if (code >= 51 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rainy';
  if (code >= 95) return 'thunderstorm';
  return 'partly-sunny';
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Céu limpo';
  if (code <= 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code === 45 || code === 48) return 'Neblina';
  if (code >= 51 && code <= 67) return 'Chuva';
  if (code >= 71 && code <= 77) return 'Neve';
  if (code >= 80 && code <= 82) return 'Pancadas de chuva';
  if (code >= 95) return 'Tempestade';
  return 'Tempo variável';
}
