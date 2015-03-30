/**

  The MIT License (MIT)

  Copyright (c) 2014 Hristo Hristov

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.

*/

var xmpp = require('node-xmpp');
var EventEmitter = require('events').EventEmitter;
var qbox = require('qbox');
var parser = require('xml2js').parseString;
var extend = require("xtend");

var friends = {}; // Maps JID -> {SummonerName, Status, Body}

//TODO add more servers
var SERVERS = {
  na: 'chat.na2.lol.riotgames.com',
  euw: 'chat.eu.lol.riotgames.com',
  eune: 'chat.eun1.lol.riotgames.com'
};

var STATUS = {
  ONLINE: 'online',
  AWAY: 'away',
  DND: 'dnd',
  OFFLINE: 'offline'
};

module.exports = new LoLXMPP();
module.exports.LoLXMPP = LoLXMPP;
module.exports.LoLXMPP.SERVERS = SERVERS;
module.exports.LoLXMPP.STATUS = STATUS;

//TODO document the code
function LoLXMPP() {
  //Settings
  var conn;
  var events;
  var self = this;
  var $ = qbox.create();
  var internalEvents = new EventEmitter();
  self.internalEvents = internalEvents;
  self.events = new EventEmitter();

  //LoL XMPP Settings;
  var username;
  var password_prefix = 'AIR_';
  var resource = 'xiff';
  var domain = 'pvp.net';
  var port = 5223;
  var legacySSL = true;

  // User information
  self.userJabberID = null;

  //Sending presence
  self.setPresence = function (show, status) {
    //TODO Add set Presence
  };

  self.getRoster = function () {
    $.ready(function () {
      var roster = new xmpp.Element('iq', { id: 'roster_0', type: 'get' });
      roster.c('query', { xmlns: 'jabber:iq:roster' });
      conn.send(roster);
    });
  };

  self.connect = function (username, password, server) {
    conn = new xmpp.Client({
      jid: username + '@' + domain + '/' + resource,
      password: password_prefix + password,
      host: server,
      port: port,
      legacySSL: legacySSL
    });

    self.conn = conn;
    self.username = username;

    conn.on('close', function () {
      $.stop();
      internalEvents.emit('close');
    });

    conn.on('error', function (err) {
      internalEvents.emit('error', err);
    });

    conn.on('online', function (data) {
      console.log(xmpp.Element);
      console.log(data);
      self.userJabberID = data.jid.user + '@' + data.jid.domain;
      conn.send(new xmpp.Element('presence'));
      internalEvents.emit('online', data);
      $.start();

      // keepalive
      if (self.conn.connection.socket) {
        self.conn.connection.socket.setTimeout(0);
        self.conn.connection.socket.setKeepAlive(true, 10000);
      }

      self.getRoster();
    });

    conn.on('stanza', function (stanza) {
      if (stanza.is('presence')) {
        internalEvents.emit('onlineFriendsInternal', stanza);
        var friendJabberID = stanza.attrs.from.split('/')[0];
        // Do not include yourself as a friend
        if (self.userJabberID == friendJabberID) {
          return;
        }
        // If there's no friend, create it.
        if (!friends[friendJabberID]) {
          friends[friendJabberID] = {};
        }
        if (stanza.attrs.type && stanza.attrs.type === 'unavailable') {
          // Friends that are going offline.
          friends[friendJabberID].status = STATUS.OFFLINE;
        } else if (stanza.children.length > 0) {
          // Online friends
          var friendStatus = stanza.children[0].children[0];
          friends[friendJabberID].status = friendStatus;
          if (friends[friendJabberID].name) {
            self.events.emit('onlineFriendsUpdate', friends[friendJabberID]);
          }
        }
      } else if (stanza.is('iq')) {
        internalEvents.emit('allFriends', stanza);
        for(var f in stanza.children[0].children) {
          var friendJabberID = stanza.children[0].children[f].attrs.jid;
          // If there's no friend, create it.
          if(!friends[friendJabberID]) {
            friends[friendJabberID] = {};
          }
          var friendName = stanza.children[0].children[f].attrs.name;
          friends[friendJabberID].name = friendName;
          if(!friends[friendJabberID].status) {
            friends[friendJabberID].status = STATUS.OFFLINE;
          }
        }
        self.events.emit('allFriendsUpdate', friends);
      } else if (stanza.is('message')) {
        if (stanza.attrs.type == 'chat') {
          var body = stanza.getChild('body');
          if (body) {
            var message = body.getText();
            var from = stanza.attrs.from;
            var id = from.split('/')[0];
            internalEvents.emit('receiveMessage', id, message);
          }
        }
      }
    });
  };

  self.getAllFriends = function () {
    return friends;
  };

  // to is the name we are sending to, message is the string to send.
  self.sendMessage = function (to, message) {
    // Use a regex so you can match mismatched cases.
    // in the client xxx == xXx === XXX
    var to_name = new RegExp(name, 'i');
    $.ready(function () {
      var jid = (function () {
        var key;
        var onlineFriends = friends.filter(friends.status !== STATUS.OFFLINE);
        for (key in onlineFriends) {
          if (key.match(to_name)) {
            return onlineFriends[key].jid;
          }
        }
        return undefined;
      })();
      if (!jid) {
        return;
      }
      jid += '/xiff';
      var stanza = new xmpp.Element('message', { to: jid, type: 'chat' });
      stanza.c('body').t(message);
      self.conn.send(stanza);
    });
  };

  internalEvents.on('receiveMessage', function (from, message) {
    self.events.emit('incomingMessage', friends[from], message);
  });
}
