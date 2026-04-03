export const BEACHES = [
  {
    id: 'copacabana',
    name: 'Copacabana',
    lat: -22.9711,
    lon: -43.1823,
    zone: 'Zona Sul',
    facing: 'SE', // direção que a praia "olha" — útil pra interpretar swell
  },
  {
    id: 'ipanema',
    name: 'Ipanema',
    lat: -22.9838,
    lon: -43.2096,
    zone: 'Zona Sul',
    facing: 'S',
  },
  {
    id: 'leblon',
    name: 'Leblon',
    lat: -22.9874,
    lon: -43.2248,
    zone: 'Zona Sul',
    facing: 'S',
  },
  {
    id: 'sao_conrado',
    name: 'São Conrado',
    lat: -23.0101,
    lon: -43.2791,
    zone: 'Zona Sul',
    facing: 'S',
  },
  {
    id: 'barra',
    name: 'Barra da Tijuca',
    lat: -23.0093,
    lon: -43.3654,
    zone: 'Zona Oeste',
    facing: 'S',
  },
  {
    id: 'recreio',
    name: 'Recreio',
    lat: -23.0178,
    lon: -43.4711,
    zone: 'Zona Oeste',
    facing: 'SW',
  },
  {
    id: 'macumba',
    name: 'Macumba',
    lat: -23.0228,
    lon: -43.5021,
    zone: 'Zona Oeste',
    facing: 'SW',
  },
  {
    id: 'prainha',
    name: 'Prainha',
    lat: -23.0367,
    lon: -43.5178,
    zone: 'Zona Oeste',
    facing: 'W',
  },
  {
    id: 'grumari',
    name: 'Grumari',
    lat: -23.0447,
    lon: -43.5347,
    zone: 'Zona Oeste',
    facing: 'W',
  },
];

// Mapa de IDs para lookup rápido
export const BEACH_MAP = Object.fromEntries(BEACHES.map(b => [b.id, b]));
