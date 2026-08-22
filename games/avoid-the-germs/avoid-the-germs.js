// Avoid the Germs — ported from https://github.com/phaserjs/examples
// (public/src/games/avoid the germs). Converted from ES modules to a
// single IIFE so it can be loaded as a plain <script> alongside the
// Arcade Hub's non-module main.js.
//
// Usage:
//   window.AvoidGerms.mount('some-dom-id');
//   window.AvoidGerms.destroy();

(function () {
  const callbacks = {
    onScoreChange: null,
    onGameOver: null,
  };

  // When true, MainMenu will skip straight to MainGame as soon as it's
  // reached, instead of waiting for a click. Used by restart() so it works
  // safely even if the game engine was just (re)created and is still
  // loading assets in Boot/Preloader.
  let autoStartOnMenu = false;

  class Boot extends Phaser.Scene {
    constructor() {
      super("Boot");
    }

    preload() {
      this.load.setPath("games/avoid-the-germs/assets/");
      this.load.image("background", "background.png");
      this.load.bitmapFont("slime", "slime-font.png", "slime-font.xml");
    }

    create() {
      this.registry.set("highscore", 0);
      this.scene.start("Preloader");
    }
  }

  class Preloader extends Phaser.Scene {
    constructor() {
      super("Preloader");
    }

    preload() {
      this.add.image(400, 300, "background").setScale(2);

      this.loadText = this.add
        .bitmapText(400, 300, "slime", "Loading ...", 80)
        .setOrigin(0.5);

      this.load.setPath("games/avoid-the-germs/assets/");
      this.load.atlas("assets", "germs.png", "germs.json");

      this.load.setPath("games/avoid-the-germs/assets/sounds/");

      this.load.audio("appear", ["appear.ogg", "appear.m4a", "appear.mp3"]);
      this.load.audio("fail", ["fail.ogg", "fail.m4a", "fail.mp3"]);
      this.load.audio("laugh", ["laugh.ogg", "laugh.m4a", "laugh.mp3"]);
      this.load.audio("music", ["music.ogg", "music.m4a", "music.mp3"]);
      this.load.audio("pickup", ["pickup.ogg", "pickup.m4a", "pickup.mp3"]);
      this.load.audio("start", ["start.ogg", "start.m4a", "start.mp3"]);
      this.load.audio("victory", ["victory.ogg", "victory.m4a", "victory.mp3"]);
    }

    create() {
      this.anims.create({
        key: "germ1",
        frames: this.anims.generateFrameNames("assets", { prefix: "red", start: 1, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: "germ2",
        frames: this.anims.generateFrameNames("assets", { prefix: "green", start: 1, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: "germ3",
        frames: this.anims.generateFrameNames("assets", { prefix: "blue", start: 1, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: "germ4",
        frames: this.anims.generateFrameNames("assets", { prefix: "purple", start: 1, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });

      if (this.sound.locked) {
        this.loadText.setText("Click to Start");

        this.input.once("pointerdown", () => {
          this.scene.start("MainMenu");
        });
      } else {
        this.scene.start("MainMenu");
      }
    }
  }

  class Germ extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, animation, speed) {
      super(scene, x, y, "assets");

      this.play(animation);

      this.setScale(Phaser.Math.FloatBetween(1, 2));

      this.speed = speed;

      this.alpha = 0;
      this.lifespan = 0;
      this.isChasing = false;

      this.target = new Phaser.Math.Vector2();
    }

    start(chaseDelay) {
      this.setCircle(14, 6, 2);

      if (!chaseDelay) {
        chaseDelay = Phaser.Math.RND.between(3000, 8000);

        this.scene.sound.play("appear");
      }

      this.scene.tweens.add({
        targets: this,
        alpha: 1,
        duration: 2000,
        ease: "Linear",
        hold: chaseDelay,
        onComplete: () => {
          if (this.scene.player.isAlive) {
            this.lifespan = Phaser.Math.RND.between(6000, 12000);
            this.isChasing = true;
          }
        },
      });

      return this;
    }

    restart(x, y) {
      this.body.reset(x, y);

      this.setActive(true);
      this.setVisible(true);
      this.setAlpha(0);

      return this.start();
    }

    preUpdate(time, delta) {
      super.preUpdate(time, delta);

      if (this.isChasing) {
        this.lifespan -= delta;

        if (this.lifespan <= 0) {
          this.isChasing = false;

          this.body.stop();

          this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: 1000,
            ease: "Linear",
            onComplete: () => {
              this.setActive(false);
              this.setVisible(false);
            },
          });
        } else {
          this.scene.getPlayer(this.target);

          this.rotation =
            this.scene.physics.moveToObject(this, this.target, this.speed) +
            1.5707963267948966;
        }
      }
    }

    stop() {
      this.isChasing = false;
      this.body.stop();
    }
  }

  class Germs extends Phaser.Physics.Arcade.Group {
    constructor(world, scene) {
      super(world, scene);

      this.classType = Germ;

      this.germConfig = [
        { animation: "germ1", speed: 60 },
        { animation: "germ2", speed: 90 },
        { animation: "germ3", speed: 120 },
        { animation: "germ4", speed: 180 },
      ];
    }

    start() {
      let germ1 = new Germ(this.scene, 100, 100, "germ1");
      let germ2 = new Germ(this.scene, 700, 600, "germ1");
      let germ3 = new Germ(this.scene, 200, 400, "germ1");

      this.add(germ1, true);
      this.add(germ2, true);
      this.add(germ3, true);

      germ1.start(1000);
      germ2.start(2000);
      germ3.start();

      this.timedEvent = this.scene.time.addEvent({
        delay: 2000,
        callback: this.releaseGerm,
        callbackScope: this,
        loop: true,
      });
    }

    stop() {
      this.timedEvent.remove();

      this.getChildren().forEach((child) => {
        child.stop();
      });
    }

    releaseGerm() {
      const x = Phaser.Math.RND.between(0, 800);
      const y = Phaser.Math.RND.between(0, 600);

      let germ;

      let config = Phaser.Math.RND.pick(this.germConfig);

      this.getChildren().forEach((child) => {
        if (child.anims.getName() === config.animation && !child.active) {
          germ = child;
        }
      });

      if (germ) {
        germ.restart(x, y);
      } else {
        germ = new Germ(this.scene, x, y, config.animation, config.speed);

        this.add(germ, true);

        germ.start();
      }
    }
  }

  class Player extends Phaser.Physics.Arcade.Image {
    constructor(scene, x, y) {
      super(scene, x, y, "assets", "player");

      scene.add.existing(this);
      scene.physics.add.existing(this);

      this.setCircle(14, 3, 6);
      this.setCollideWorldBounds(true);

      this.isAlive = false;

      this.speed = 280;
      this.target = new Phaser.Math.Vector2();
    }

    start() {
      this.isAlive = true;

      this.scene.input.on("pointermove", (pointer) => {
        if (this.isAlive) {
          this.target.x = pointer.x;
          this.target.y = pointer.y;

          this.rotation =
            this.scene.physics.moveToObject(this, this.target, this.speed) +
            1.5707963267948966;
        }
      });
    }

    kill() {
      this.isAlive = false;
      this.body.stop();
    }

    preUpdate() {
      if (this.body.speed > 0 && this.isAlive) {
        if (
          Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y) < 6
        ) {
          this.body.reset(this.target.x, this.target.y);
        }
      }
    }
  }

  class Pickups extends Phaser.Physics.Arcade.Group {
    constructor(world, scene) {
      super(world, scene);

      this.outer = new Phaser.Geom.Rectangle(64, 64, 672, 472);
      this.target = new Phaser.Math.Vector2();
    }

    start() {
      this.create(400, 100, "assets", "ring");
      this.create(100, 380, "assets", "ring");
      this.create(700, 380, "assets", "ring");
      this.create(300, 500, "assets", "ring");
      this.create(500, 500, "assets", "ring");
    }

    collect(pickup) {
      this.outer.getRandomPoint(this.target);

      pickup.body.reset(this.target.x, this.target.y);
    }
  }

  class MainMenu extends Phaser.Scene {
    constructor() {
      super("MainMenu");
    }

    create() {
      if (autoStartOnMenu) {
        autoStartOnMenu = false;
        this.scene.start("MainGame");
        return;
      }

      this.music = this.sound.play("music", { loop: true });

      this.sound.play("laugh");

      this.add.image(400, 300, "background").setScale(2);

      const area = new Phaser.Geom.Rectangle(64, 64, 672, 472);

      this.addGerm(area, "germ1");
      this.addGerm(area, "germ2");
      this.addGerm(area, "germ3");
      this.addGerm(area, "germ4");

      this.add.image(400, 260, "assets", "logo");

      this.add.bitmapText(400, 500, "slime", "Click to Play", 40).setOrigin(0.5);

      this.input.once("pointerdown", () => {
        this.scene.start("MainGame");
      });
    }

    addGerm(area, animation) {
      let start = area.getRandomPoint();

      let germ = this.add.sprite(start.x, start.y).play(animation).setScale(2);

      let durationX = Phaser.Math.Between(4000, 6000);
      let durationY = durationX + 3000;

      this.tweens.add({
        targets: germ,
        x: {
          getStart: () => germ.x,
          getEnd: () => area.getRandomPoint().x,
          duration: durationX,
          ease: "Linear",
        },
        y: {
          getStart: () => germ.y,
          getEnd: () => area.getRandomPoint().y,
          duration: durationY,
          ease: "Linear",
        },
        repeat: -1,
      });
    }
  }

  class MainGame extends Phaser.Scene {
    constructor() {
      super("MainGame");

      this.player = null;
      this.germs = null;
      this.pickups = null;

      this.introText = null;
      this.scoreText = null;
      this.score = 0;
      this.highscore = 0;
      this.newHighscore = false;
    }

    create() {
      this.score = 0;
      this.highscore = this.registry.get("highscore");
      this.newHighscore = false;

      this.add.image(400, 300, "background").setScale(2);

      this.germs = new Germs(this.physics.world, this);

      this.pickups = new Pickups(this.physics.world, this);

      this.player = new Player(this, 400, 400);

      this.scoreText = this.add
        .bitmapText(16, 32, "slime", "Score   0", 40)
        .setDepth(1);

      this.introText = this.add
        .bitmapText(400, 300, "slime", "Avoid the Germs\nCollect the Rings", 60)
        .setOrigin(0.5)
        .setCenterAlign()
        .setDepth(1);

      this.pickups.start();

      this.input.once("pointerdown", () => {
        this.player.start();
        this.germs.start();

        this.sound.play("start");

        this.tweens.add({
          targets: this.introText,
          alpha: 0,
          duration: 300,
        });
      });

      this.physics.add.overlap(this.player, this.pickups, (player, pickup) =>
        this.playerHitPickup(player, pickup)
      );
      this.physics.add.overlap(this.player, this.germs, (player, germ) =>
        this.playerHitGerm(player, germ)
      );
    }

    playerHitGerm(player, germ) {
      if (player.isAlive && germ.alpha === 1) {
        this.gameOver();
      }
    }

    playerHitPickup(player, pickup) {
      this.score++;

      this.scoreText.setText("Score   " + this.score);

      if (callbacks.onScoreChange) {
        callbacks.onScoreChange(this.score);
      }

      if (!this.newHighscore && this.score > this.highscore) {
        if (this.highscore > 0) {
          this.sound.play("victory");
        } else {
          this.sound.play("pickup");
        }

        this.newHighscore = true;
      } else {
        this.sound.play("pickup");
      }

      this.pickups.collect(pickup);
    }

    gameOver() {
      this.player.kill();
      this.germs.stop();

      this.sound.stopAll();
      this.sound.play("fail");

      this.introText.setText("Game Over!");

      this.tweens.add({
        targets: this.introText,
        alpha: 1,
        duration: 300,
      });

      if (this.newHighscore) {
        this.registry.set("highscore", this.score);
      }

      if (callbacks.onGameOver) {
        callbacks.onGameOver(this.score);
      }

      this.input.once("pointerdown", () => {
        this.scene.start("MainMenu");
      });
    }

    getPlayer(target) {
      target.x = this.player.x;
      target.y = this.player.y;

      return target;
    }
  }

  let gameInstance = null;

  function mount(parentId, options) {
    callbacks.onScoreChange = (options && options.onScoreChange) || null;
    callbacks.onGameOver = (options && options.onGameOver) || null;

    if (gameInstance) {
      // The hub sometimes fully re-renders the surrounding DOM (e.g. after a
      // balance update) which replaces the parent container with a new
      // element. If that happened, the old canvas is now detached/invisible
      // even though gameInstance is still a valid object. Detect that and
      // recreate the game in the current (new) container instead of
      // silently keeping a reference to an orphaned canvas.
      const canvas = gameInstance.canvas;
      const stillAttached = canvas && document.body.contains(canvas);
      if (stillAttached) {
        return gameInstance;
      }
      gameInstance.destroy(true);
      gameInstance = null;
    }

    if (typeof Phaser === "undefined") {
      console.error("[AvoidGerms] Phaser library is not loaded.");
      return null;
    }

    gameInstance = new Phaser.Game({
      type: Phaser.AUTO,
      width: 800,
      height: 600,
      backgroundColor: "#000000",
      parent: parentId,
      scene: [Boot, Preloader, MainMenu, MainGame],
      physics: {
        default: "arcade",
        arcade: { debug: false },
      },
    });

    return gameInstance;
  }

  function restart() {
    if (!gameInstance || !gameInstance.scene) {
      return;
    }

    const sceneManager = gameInstance.scene;
    const menuReady = sceneManager.isActive("MainMenu") || sceneManager.isActive("MainGame");

    if (menuReady) {
      sceneManager.start("MainGame");
    } else {
      // Engine is still on Boot/Preloader (e.g. right after a fresh
      // recreate) - defer starting MainGame until MainMenu is reached
      // to avoid racing asset loading.
      autoStartOnMenu = true;
    }
  }

  function destroy() {
    if (gameInstance) {
      gameInstance.destroy(true);
      gameInstance = null;
    }
    autoStartOnMenu = false;
    callbacks.onScoreChange = null;
    callbacks.onGameOver = null;
  }

  window.AvoidGerms = { mount, restart, destroy };
})();
