import BasePlugin from './base-plugin.js';
import Logger from 'core/logger';

export default class AutoKickAFK extends BasePlugin {
  static get description() {
    return 'The <code>AutoKickAFK</code> plugin will automatically kick players that are not in a squad after a specified ammount of time.';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      warningMessage: {
        required: false,
        description: 'Message SquadJS will send to players warning them they will be kicked',
        default: 'Join a squad, you are are unassigned and will be kicked'
      },
      kickMessage: {
        required: false,
        description: 'Message to send to players when they are kicked',
        default: 'Unassigned - automatically removed'
      },
      frequencyOfWarnings : {
        required: false,
        description: 'How often in seconds should we warn the player about being AFK?',
        default: 30
      },
      afkTimer: {
        required: false,
        description: 'How long in minutes to wait before a player that is AFK is kicked',
        default: 6
      },
      playerThreshold:{
        required: false,
        description: 'Player count required for Auto Kick to start kicking players to disable set to -1 to disable',
        default: 93
      },
      queueThreshold:{
        required: false,
        description: 'The number of players in the queue before Auto Kick starts kicking players set to -1 to disable',
        default: -1
      },
      roundStartDelay:{
        required: false,
        description: 'Time delay in minutes from start of the round before auto AFK starts kicking again',
        default: 15
      }/*, to be added in future when we can track admins better
      ignoreAdmins:{
        required: false,
        description: 'Whether or not admins will be auto kicked for being unassigned',
        default: false
      }*/
    };
  }

  constructor(server, options) {
    super();

    this.kickTimeout =  options.afkTimer * 60 * 1000;
    this.warningInterval = options.frequencyOfWarnings * 1000;
    this.gracePeriod = options.roundStartDelay * 60 * 1000;

    this.betweenRounds = false;

    this.trackedPlayers = {};

    server.on('NEW_GAME', async (info) => {
      this.betweenRounds = true;
      updateTrackingList();
      setTimeout(async ()=>{
        this.betweenRounds = false;
      }, this.gracePeriod);
    });

    server.on('PLAYER_SQUAD_CHANGE', async (player) =>{
      if (player.steamID in this.trackedPlayers && player.squadID !== null){
        untrackPlayer(player.steamID);
      }
    });

    const runConditions = ()=>{
      return ( !this.betweenRounds || (0 < options.playerCountThreshold < server.players.count) || (0 < options.queueThreshold < (server.publicQueue + server.reserveQueue)) )
    }

    const updateTrackingList = async ()=>{
      if( !runConditions() ){
        // clear all tracked players if run conditions are not met.
        for(const steamID of Object.keys(this.trackedPlayers))
          untrackPlayer(steamID);
        return;
      } 

      //await server.updatePlayerList();

      // loop through players on server and start tracking players not in a squad
      for (const player of server.players) {
        let isTracked = (player.steamID in this.trackedPlayers);
        let isUnassigned = (player.squadID === null);

        if(isUnassigned && !isTracked)
          this.trackedPlayers[player.steamID] = trackPlayer(player.steamID); // start tracking player
        if(!isUnassigned && isTracked)
          untrackPlayer(player.steamID); // tracked player joined a squad remove them
      }
    }

    const trackPlayer = async (steamID)=>{
      Logger.verbose('AutoAFK', 2, `[AutoAFK] Tracking: ${steamID}`);
      let trackStart = Date.now();
      let warnTimerID = setInterval( async ()=> {
        let msLeft = this.kickTimeout-(Date.now()-trackStart);
        let min = Math.floor((msLeft/1000/60) << 0);
        let sec = Math.floor((msLeft/1000) % 60);
        server.rcon.warn(steamID, `${options.warningMessage} - ${min}:${sec}`);
      }, this.warningInterval);

      let kickTimerID = setTimeout(async ()=>{
        server.rcon.kick(steamID, options.kickMessage);
      }, this.kickTimeout);
      return [warnTimerID, kickTimerID]
    }

    const untrackPlayer = async (steamID)=>{
      Logger.verbose('AutoAFK', 2, `[AutoAFK] unTrack: ${steamID}`);
      clearInterval(this.trackedPlayers[steamID][0]); // clears warning interval
      clearTimeout(this.trackedPlayers[steamID][1]); // clears kick timeout
      delete this.trackedPlayers[steamID];
    }

    setInterval(updateTrackingList , 1*60*1000); //tracking list update loop

    //clean up every 20 minutes, removes players no longer on the server that may be stuck in the tracking dict
    const cleanupMS = 20*60*1000;
    setInterval( ()=>{
      for(const steamID of Object.keys(this.trackedPlayers))
        if(!steamID in server.players.map(p => p.steamID))
          untrackPlayer(steamID);
    }, cleanupMS);

  }
}
