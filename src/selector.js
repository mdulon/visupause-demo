function shuffleIndices(length) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function pickExercise({ exercises, order, cursor, lastCategory, fatigueMinutes, missedBreaks }) {
  if (!exercises.length) return null;
  let nextOrder = Array.isArray(order) && order.length === exercises.length ? order : shuffleIndices(exercises.length);
  let nextCursor = Number.isFinite(cursor) ? cursor : 0;

  if (nextCursor > 0 && nextCursor % nextOrder.length === 0) {
    nextOrder = shuffleIndices(exercises.length);
    nextCursor = 0;
  }

  const preferRecovery = fatigueMinutes >= 25 || missedBreaks >= 2;
  const recoveryCategories = new Set(['relaxation', 'breath', 'peripheral', 'neck']);

  let choice = nextOrder[nextCursor % nextOrder.length];
  let offsetUsed = 0;

  for (let offset = 0; offset < nextOrder.length; offset += 1) {
    const index = nextOrder[(nextCursor + offset) % nextOrder.length];
    const exercise = exercises[index];
    const avoidsRepeat = exercise.cat !== lastCategory;
    const fitsFatigue = !preferRecovery || recoveryCategories.has(exercise.cat);
    if (avoidsRepeat && fitsFatigue) {
      choice = index;
      offsetUsed = offset;
      break;
    }
  }

  return {
    exercise: exercises[choice],
    order: nextOrder,
    cursor: nextCursor + offsetUsed + 1
  };
}

window.VisuSelector = { pickExercise, shuffleIndices };
