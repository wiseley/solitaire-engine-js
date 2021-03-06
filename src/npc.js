const Game = require('./game.js').Game;

// computer plays solitaire
class Npc {
  movedInPass = false;
  won = false;
  eventStack = 0;
  stepMode = false;
  steps = 0;

  constructor(game) {
    this.game = game;
    game.addEventListener((t,d) => { this.eventListener(t,d); });
  }

  // plays game in response to card reveals
  eventListener(type, data) {
    this.eventStack++;
    if (this.eventStack > 20) {
      console.log('Event Stack Exceeded - Exiting');
      process.exit();
    }
    if (type == Game.EV.REVEAL) {
      if (!this.keepGoing()) { this.eventStack--; return; }
      // test for source
      let src = this.findSource(data.tableau);
      if (src != undefined) {
        this.game.move('t', src.tableau, src.count, 't', data.tableau);
        if (!this.keepGoing()) { this.eventStack--; return; }
        this.consolidateTableau(data.tableau);
      } 
      else if (data.card != undefined) { // if not an empty tableau
        // foundation
        let fix = this.game.foundationMatch(data.card);
        if (fix > 0) {
          this.game.move('t', data.tableau, 1, 'f', fix);
        }
        else {
          // consolidate
          this.consolidateTableau(data.tableau);
        }
      }
    }
    else if (type == Game.EV.DRAW) {
      if (!this.keepGoing(true)) { this.eventStack--; return; }
      let fix = this.game.foundationMatch(data.cards.last());
      if (fix > 0) {
        this.game.move('w', 0, 1, 'f', fix);
      } else {
        this.playDeck();
      }
    }
    if (type == Game.EV.MOVE && data.success) {
      if (!this.keepGoing(true)) { this.eventStack--; return; }
      this.movedInPass = true;
      // test for win on move to foundation
      if (data.to == 'f') {
        // test table against new foundation rank
        this.autoFoundation();
        this.won = this.game.hasWon();
      }
      // test for consolidation onto new tableau leaf from waste
      else if (data.to == 't' && data.from == 'w') {
        let src = this.findSource(data.toIx);
        if (src != undefined) {
          this.game.move('t', src.tableau, src.count, 't', data.toIx);
        }
      }
    }
    this.eventStack--;
  }

  // kicks things off with full foundation and tableau consolidation
  // checks, then runs through deck until a full run results in no
  // moves. tests for win status along the way
  playGame(stepMode) {
    this.stepMode = stepMode;
    this.steps = 0;
    this.autoFoundation();
    if (!this.keepGoing()) return;
    this.consolidateTableaus();
    if (!this.keepGoing()) return;
    while (true) {
      // run through the deck
      while (this.game.stock.length > 0) {
        if (!this.keepGoing()) return;
        this.game.draw();
        if (this.won) return true;
      }
      if (!this.keepGoing()) return;
      if (this.movedInPass) {
        this.game.restock();
        this.movedInPass = false;
      }
      else {
        // exit if no movement in a full run through the deck
        return this.won;
      }
    }
  }

  // plays what can be played to the foundations from tableau and waste
  autoFoundation() {
    let g = this.game;
    for (const tix of g.tableau.keys()) {
      let t = g.tableau[tix];
      if (t.length > 0) {
        let fix = g.foundationMatch(t.last());
        if (fix > 0) {
          g.move('t', tix + 1, 1, 'f', fix);
          if (!this.keepGoing()) return;
        }
      }
    }
    if (g.waste.length > 0) {
      let fix = g.foundationMatch(g.waste.last());
      if (fix > 0) {
        g.move('w', undefined, 1, 'f', fix);
      }
    }
  }

  // returns first face up card in a given array of Cards
  firstFaceUp(a) {
    for (let i = 0; i < a.length; i++) {
      let c = a[i];
      if (c.faceUp || i == a.length -1) return i;
    }
    return undefined;
  }

  // attempt to expose tableau cards by consolidating stacks
  consolidateTableaus() {
    let len = this.game.tableau.length;
    for (let i = 0; i < len; i++) {
      if (!this.keepGoing()) return;
      this.consolidateTableau(i+1);
    }
  }

  // tries to consolidate the given tableau as a source or target
  consolidateTableau(tix) {
    let t = this.game.tableau[tix-1];
    if (t.length == 0) return false;
    // get the lowest face up card
    let fix = this.firstFaceUp(t);
    let c = t[fix];
    // don't bother moving a king that's at the top of the stack
    if (c.rank == 13 && fix == 0) return false; 
    // find a better home
    let targetIx = this.findTarget(c, tix);
    let g = this.game;
    if (targetIx != undefined) {
      if (g.move('t', tix, t.length - fix, 't', targetIx)) {
        return true;
      }
      else {
        console.log("ERROR: consolidateTableau", tix, t.length - fix, targetIx);
      }
    }
    else {
      let source = this.findSource(tix);
      if (source != undefined) {
        if (g.move('t', source.tableau, source.count, 't', tix)) {
          return true;
        }
      }
    }
    return false;
  }

  // attempt to play the top waste card in a way that will lead to tableau consolidation, failing that, try the foundations
  // recurses if successful to play revealed waste card
  playDeck() {
    if (this.game.waste.length == 0) return false;
    let c = this.game.waste.last();
    let targetIx = this.findTarget(c);
    if (targetIx != undefined) {
      let rider = this.findRider(c, targetIx);
      if (rider != undefined)  {
        if (!this.game.move('w', undefined, 1, 't', targetIx)) {
        console.log('Error moving at playDeck 1');
        }
        this.playDeck();
        return true;
      }
    }
    // try foundations
    let fix = this.game.foundationMatch(c);
    if (fix > 0) {
      if (!this.game.move('w', undefined, 1, 'f', fix)) {
        console.log('Error moving at playDeck 2');
      }
      this.playDeck();
      return true;
    }
    return false;
  }
    
  // returns 1-based index of tableau that can accept the 
  // given card, or undefined; ignores the tableau at 
  // given 1 based index
  findTarget(card, ignoreIx) {
    let g = this.game;
    let ts = g.tableau;
    let targetIx;
    // for each tableau stack
    for (let i = 0; i < ts.length; i++) {
      if (i != ignoreIx-1) {
        let t = ts[i];
        if (t.length > 0) {
          let dest = t.last();
          // must be opposite color
          if (!g.sameColor(card, dest)) {
            // and be 1 rank smaller
            if (card.rank == dest.rank - 1) {
              return i+1;
            }
          }
        }
        // only kings can target an empty tableau
        else if (card.rank == 13) {
          return i+1;
        }
      }
    }
    return undefined;
  }
  
  // returns the 1-based index of a tableau and card count that can be consolidated 
  // into the given tableau, or undefined
  findSource(tix) {
    let g = this.game;
    let len = g.tableau.length;
    for (let i = 0; i < len; i++) {
      if (tix == i+1) continue;
      let t = g.tableau[i];
      let fix = this.firstFaceUp(t);
      if (fix == undefined) continue;
      let card = t[fix];
      let count = t.length - fix;
      if (g.canMove('t', i+1, count, 't', tix)) {
        return { "tableau": i+1, "count": count };
      }
    }
    return undefined;
  }
  
  // finds a tableau stack that can be a future consolidation 
  // if the given card is played from the deck or foundation
  findRider(card, ignoreIx) {
    let g = this.game;
    let riders = [];
    let shortestDistance = 13;
    let closestRider;
    for (let tix = 0; tix < g.tableau.length; tix++) {
      let t = g.tableau[tix];
      if (tix == ignoreIx) continue;
      if (t.length == 0) continue;
      let riderCard = t[this.firstFaceUp(t)];
      if (riderCard.rank >= card.rank) continue;
      if (!g.tableauCompatible(card, riderCard)) continue;
      let distance = card.rank - riderCard.rank;
      let closerHorse = this.findCloserHorse(riderCard, distance, tix, ignoreIx);
      if (closerHorse != undefined) continue;
      if (distance < shortestDistance) {
        shortestDistance = distance;
        closestRider = tix;
      }
    }
    return closestRider; 
  }

  findCloserHorse (rider, distance, ignoreIx, ignoreIx2) {
    let g = this.game;
    for (let tix = 0; tix < g.tableau.length; tix++) {
      let t = g.tableau[tix];
      if (tix == ignoreIx || tix == ignoreIx2) continue;
      if (t.length == 0) continue;
      let horse = t[this.firstFaceUp(t)];
      if (!g.tableauCompatible(horse, rider)) continue;
      if (horse.rank <= rider.rank) continue;
      if ((horse.rank - rider.rank) < distance) return tix;
    }
    return undefined;
  }

  // test for whether to stop after a single step 
  keepGoing (stepTaken = false) {
    if (stepTaken) this.steps++;
    //console.log(`keepGoing stepTaken=${stepTaken} steps=${this.steps}`);
    if (this.stepMode && this.steps > 0) {
      return false;
    }
    return true;
  }
}

module.exports = {
  Npc: Npc
}
