function scoreColor(score) {
  return score >= 80 ? '#28d4b4' : score >= 60 ? '#7c83f5' : score >= 40 ? '#e8a020' : '#e05050';
}

function scoreLabel(score) {
  return score >= 90 ? 'Excellent' : score >= 75 ? 'Bon' : score >= 60 ? 'Correct' : score >= 40 ? 'Fatigué' : 'Critique';
}

function calculateEyeScore({ breaksDue, breaksTaken, lastBreakTime, intervalMinutes = 20, inBreak = false, breakPending = false }) {
  const currentBreakCredit = inBreak ? 1 : 0;
  const missedBreaks = Math.max(0, breaksDue - breaksTaken - currentBreakCredit);
  const minutesSinceBreak = (Date.now() - lastBreakTime) / 60000;
  const overdueMinutes = breakPending ? Math.max(0, minutesSinceBreak - intervalMinutes) : 0;
  const missedPenalty = missedBreaks * 18;
  const overduePenalty = Math.min(30, overdueMinutes * 2);
  return Math.max(0, Math.round(100 - missedPenalty - overduePenalty));
}

window.VisuScore = { calculateEyeScore, scoreColor, scoreLabel };
