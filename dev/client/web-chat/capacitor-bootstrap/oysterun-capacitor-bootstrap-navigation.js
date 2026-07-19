(function installOysterunCapacitorBootstrapNavigation(global) {
  'use strict';

  function createNavigationCoordinator(priorities) {
    if (!priorities || typeof priorities !== 'object') {
      throw new Error('Capacitor bootstrap navigation priorities are required.');
    }

    let generation = 0;
    let currentClaim = null;

    function getPriority(owner) {
      const priority = priorities[owner];
      if (!Number.isFinite(priority)) {
        throw new Error(`Unknown Capacitor bootstrap navigation owner: ${owner}`);
      }
      return priority;
    }

    function claim(owner, metadata = {}) {
      const priority = getPriority(owner);
      if (currentClaim && currentClaim.priority > priority) return null;

      generation += 1;
      currentClaim = Object.freeze({
        owner,
        priority,
        generation,
        metadata: Object.freeze({ ...metadata }),
      });
      return currentClaim;
    }

    function isCurrent(claimToCheck) {
      return Boolean(
        claimToCheck &&
          currentClaim &&
          claimToCheck.owner === currentClaim.owner &&
          claimToCheck.generation === currentClaim.generation
      );
    }

    function getCurrent() {
      return currentClaim;
    }

    return Object.freeze({
      claim,
      isCurrent,
      getCurrent,
    });
  }

  global.OysterunCapacitorBootstrapNavigation = Object.freeze({
    createNavigationCoordinator,
  });
})(window);
