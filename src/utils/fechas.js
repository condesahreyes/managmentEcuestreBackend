/**
 * Utilidades para manejo de fechas
 */

/**
 * Calcula el día 10 hábil de un mes
 * @param {number} mes - Mes (1-12)
 * @param {number} año - Año
 * @returns {Date} Fecha del día 10 hábil
 */
export function calcularDia10Habil(mes, año) {
  let fecha = new Date(año, mes - 1, 1);
  let diasHabiles = 0;
  let diaActual = 1;

  while (diasHabiles < 10) {
    const diaSemana = fecha.getDay();
    // Lunes a Viernes son hábiles (1-5)
    if (diaSemana >= 1 && diaSemana <= 5) {
      diasHabiles++;
      if (diasHabiles === 10) {
        return fecha;
      }
    }
    fecha.setDate(++diaActual);
  }
  return fecha;
}

/**
 * Verifica si una fecha está dentro de los primeros 10 días hábiles del mes
 * @param {Date} fecha - Fecha a verificar
 * @returns {boolean} true si está dentro de los primeros 10 días hábiles
 */
export function estaEnPrimeros10Habiles(fecha) {
  const mes = fecha.getMonth() + 1;
  const año = fecha.getFullYear();
  const dia10Habil = calcularDia10Habil(mes, año);
  
  return fecha <= dia10Habil;
}

/**
 * Obtiene el último día del mes
 * @param {Date} fecha - Fecha dentro del mes
 * @returns {Date} Último día del mes
 */
export function obtenerUltimoDiaDelMes(fecha) {
  const año = fecha.getFullYear();
  const mes = fecha.getMonth() + 1;
  return new Date(año, mes, 0);
}

/**
 * Obtiene el primer día del siguiente mes
 * @param {Date} fecha - Fecha actual
 * @returns {Date} Primer día del siguiente mes
 */
export function obtenerPrimerDiaSiguienteMes(fecha) {
  const año = fecha.getFullYear();
  const mes = fecha.getMonth() + 1;
  return new Date(año, mes, 1);
}

export function  toMinutes(hora) {
      const [h, m] = hora.split(':');
      return Number(h) * 60 + Number(m);
    }