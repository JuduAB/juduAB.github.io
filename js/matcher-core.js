(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioMatchCore = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    scoreTemperature: 0.3,
    originalPenalty: 0.2,
    savePenaltyMax: 1.0,
    saveWeight: 0.5,
    radius: 1
  });

  function manhattan(left, right) {
    if (left.length !== right.length) throw new RangeError('MFCC dimensions differ');
    let sum = 0;
    for (let index = 0; index < left.length; index += 1) {
      sum += Math.abs(left[index] - right[index]);
    }
    return sum;
  }

  function reduceByHalf(sequence) {
    const reduced = [];
    for (let index = 0; index + 1 < sequence.length; index += 2) {
      const first = sequence[index];
      const second = sequence[index + 1];
      const average = new Array(first.length);
      for (let coefficient = 0; coefficient < first.length; coefficient += 1) {
        average[coefficient] = (first[coefficient] + second[coefficient]) / 2;
      }
      reduced.push(average);
    }
    return reduced;
  }

  function exactDtw(left, right, distance = manhattan) {
    const rows = left.length;
    const columns = right.length;
    const costs = new Float64Array(rows * columns);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int8Array(rows * columns);
    previous.fill(-1);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const pointCost = distance(left[row], right[column]);
        if (row === 0 && column === 0) {
          costs[index] = pointCost;
          continue;
        }

        let bestCost = Number.POSITIVE_INFINITY;
        let direction = -1;
        if (column > 0 && costs[index - 1] < bestCost) {
          bestCost = costs[index - 1];
          direction = 2;
        }
        if (row > 0 && costs[index - columns] < bestCost) {
          bestCost = costs[index - columns];
          direction = 1;
        }
        if (row > 0 && column > 0 && costs[index - columns - 1] < bestCost) {
          bestCost = costs[index - columns - 1];
          direction = 0;
        }
        costs[index] = pointCost + bestCost;
        previous[index] = direction;
      }
    }

    const path = [];
    let row = rows - 1;
    let column = columns - 1;
    while (row >= 0 && column >= 0) {
      path.push([row, column]);
      const direction = previous[row * columns + column];
      if (direction === 0) {
        row -= 1;
        column -= 1;
      } else if (direction === 1) {
        row -= 1;
      } else if (direction === 2) {
        column -= 1;
      } else {
        break;
      }
    }
    path.reverse();
    return { cost: costs[rows * columns - 1], path };
  }

  function expandedWindow(path, leftLength, rightLength, radius) {
    const expanded = new Set();
    for (const [row, column] of path) {
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
          expanded.add(`${row + rowOffset},${column + columnOffset}`);
        }
      }
    }

    const cells = new Set();
    for (const cell of expanded) {
      const [baseRow, baseColumn] = cell.split(',').map(Number);
      for (let rowOffset = 0; rowOffset < 2; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
          cells.add(`${baseRow * 2 + rowOffset},${baseColumn * 2 + columnOffset}`);
        }
      }
    }

    const window = [];
    let startColumn = 0;
    for (let row = 0; row < leftLength; row += 1) {
      let nextStartColumn = null;
      for (let column = startColumn; column < rightLength; column += 1) {
        if (cells.has(`${row},${column}`)) {
          window.push([row, column]);
          if (nextStartColumn === null) nextStartColumn = column;
        } else if (nextStartColumn !== null) {
          break;
        }
      }
      startColumn = nextStartColumn;
    }
    return window;
  }

  function windowedDtw(left, right, window, distance) {
    const rows = left.length;
    const columns = right.length;
    const costs = new Float64Array(rows * columns);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int8Array(rows * columns);
    previous.fill(-1);

    for (const [row, column] of window) {
      const index = row * columns + column;
      const pointCost = distance(left[row], right[column]);
      if (row === 0 && column === 0) {
        costs[index] = pointCost;
        continue;
      }
      let bestCost = Number.POSITIVE_INFINITY;
      let direction = -1;
      if (column > 0 && costs[index - 1] < bestCost) {
        bestCost = costs[index - 1];
        direction = 2;
      }
      if (row > 0 && costs[index - columns] < bestCost) {
        bestCost = costs[index - columns];
        direction = 1;
      }
      if (row > 0 && column > 0 && costs[index - columns - 1] < bestCost) {
        bestCost = costs[index - columns - 1];
        direction = 0;
      }
      costs[index] = pointCost + bestCost;
      previous[index] = direction;
    }

    const path = [];
    let row = rows - 1;
    let column = columns - 1;
    while (row >= 0 && column >= 0) {
      path.push([row, column]);
      const direction = previous[row * columns + column];
      if (direction === 0) {
        row -= 1;
        column -= 1;
      } else if (direction === 1) {
        row -= 1;
      } else if (direction === 2) {
        column -= 1;
      } else {
        break;
      }
    }
    path.reverse();
    return { cost: costs[rows * columns - 1], path };
  }

  function fastDtw(left, right, radius = DEFAULTS.radius, distance = manhattan) {
    if (!left.length || !right.length) return { cost: Number.POSITIVE_INFINITY, path: [] };
    if (left.length < radius + 2 || right.length < radius + 2) {
      return exactDtw(left, right, distance);
    }
    const reducedLeft = reduceByHalf(left);
    const reducedRight = reduceByHalf(right);
    if (!reducedLeft.length || !reducedRight.length) return exactDtw(left, right, distance);
    const coarse = fastDtw(reducedLeft, reducedRight, radius, distance);
    const window = expandedWindow(coarse.path, left.length, right.length, radius);
    return windowedDtw(left, right, window, distance);
  }

  function normalizedDistance(query, reference, radius = DEFAULTS.radius) {
    return fastDtw(query, reference, radius).cost / (query.length + reference.length);
  }

  function minimumDistance(query, references, radius) {
    if (!references?.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const reference of references) {
      const candidate = normalizedDistance(query, reference, radius);
      if (candidate < best) best = candidate;
    }
    return best;
  }

  function matchFeatures(query, featureTiers, options = {}) {
    if (!query?.length) return null;
    const settings = { ...DEFAULTS, ...options };
    const distances = {};
    for (const [category, tiers] of Object.entries(featureTiers)) {
      const candidates = [
        minimumDistance(query, tiers.templates, settings.radius),
        minimumDistance(query, tiers.originals, settings.radius) + settings.originalPenalty
      ];
      if (settings.saveWeight > 0 && tiers.save?.length) {
        const penalty = settings.savePenaltyMax * (1 - settings.saveWeight);
        candidates.push(minimumDistance(query, tiers.save, settings.radius) + penalty);
      }
      distances[category] = Math.min(...candidates);
    }

    const entries = Object.entries(distances);
    if (!entries.length) return null;
    entries.sort((left, right) => left[1] - right[1]);
    const [category, distance] = entries[0];
    const weights = entries.map(([, value]) => Math.exp(-(value - distance) / settings.scoreTemperature));
    const confidence = 1 / weights.reduce((total, weight) => total + weight, 0);
    return { category, confidence, distances };
  }

  return Object.freeze({
    DEFAULTS,
    manhattan,
    exactDtw,
    fastDtw,
    normalizedDistance,
    matchFeatures
  });
});