/**
 * Every word the player reads. English is the default; Korean is one click
 * away and remembered per browser. The server never picks a language: it sends
 * codes and parameters, and each screen words them for its own reader.
 */

const STORAGE_KEY = 'pm-lang';
export const LANGS = ['en', 'ko'];
const DEFAULT_LANG = 'en';

const plural = (n, one, many) => (n === 1 ? one : many);

const en = {
  'doc.title': 'PokerMaster: Hold\'em practice table',
  'lang.switch': '한국어',
  'lang.switchTitle': 'Switch language',

  // top bar
  'top.fourColor': 'Four-color deck',
  'top.sound': 'Sound',
  'top.pause': 'Pause',
  'top.resume': 'Resume',
  'top.invite': 'Invite',
  'top.settings': 'Settings',
  'top.stand': 'Stand up',
  'top.waiting': 'Waiting',
  'top.hand': ({ n }) => `Hand #${n}`,
  'top.watching': ({ n }) => `${n} watching`,
  'top.blinds': ({ sb, bb }) => `Blinds ${sb} / ${bb}`,
  'top.untilEnd': ({ time }) => `${time} left`,
  'top.lastHand': 'Last hand',
  'top.nextLevel': ({ sb, bb, time }) => `Next ${sb}/${bb} · ${time}`,
  'top.levelUpNext': 'Blinds go up next hand',

  // pause
  'pause.title': 'Paused',
  'pause.waitHost': 'Waiting for the host to resume',
  'pause.hostHint': 'Press Resume to carry on',

  // menu
  'menu.tagline': 'A Hold\'em practice table for friends on the same Wi-Fi',
  'menu.taglineHost': 'Start once everyone is here. Everyone sits down together.',
  'menu.taglineWaiting': 'You\'re ready to sit down. Chat while you wait.',
  'menu.taglineJoin': 'This table is already running. Pick a name and take a seat.',
  'menu.taglineLocked': 'The tournament has already started, so you can only watch.',
  'menu.nickname': 'Nickname',
  'menu.nicknamePlaceholder': 'e.g. Alex',
  'menu.players': ({ n, max }) => `Players ${n} / ${max}`,
  'menu.spectators': ({ n }) => `${n} watching`,
  'menu.noSpectators': 'Nobody is watching',
  'menu.empty': 'Nobody here yet',
  'menu.host': 'Host',
  'menu.chatPlaceholder': 'Send a message',
  'menu.send': 'Send',
  'menu.gameMode': 'Game mode',
  'menu.structure': 'Blind increase',
  'menu.levelLength': 'Level length',
  'menu.totalTime': 'Total time',
  'menu.rebuys': 'Rebuys',
  'menu.aiBots': 'AI bots',
  'menu.fewerBots': 'Fewer bots',
  'menu.moreBots': 'More bots',
  'menu.botMode': 'Bot mode',
  'menu.botSkill': 'Bot difficulty',
  'menu.blinds': 'Blinds',
  'menu.startingStack': 'Starting stack',
  'menu.enter': 'Enter game',
  'menu.start': 'Start game',
  'menu.waitHost': 'Waiting for the host to start',
  'menu.join': 'Join',
  'menu.tournamentRunning': 'Tournament in progress',
  'menu.noSeats': 'No seats left',
  'menu.watch': 'Watch',
  'menu.minutes': ({ n }) => `${n} min`,

  'mode.tournament': 'Tournament',
  'mode.timed': 'Timed',
  'mode.cash': 'Cash game',
  'structure.standard': 'Standard',
  'structure.turbo': 'Turbo',
  'structure.standardPreset': 'Standard 1.5x',
  'structure.turboPreset': 'Turbo 2x',
  'rebuy.none': 'None',
  'rebuy.count': ({ n }) => `${n}x`,
  'rebuy.unlimited': 'Unlimited',
  'botMode.casual': 'Casual',
  'botMode.practice': 'Practice',
  'botSkill.easy': 'Easy',
  'botSkill.normal': 'Normal',
  'botSkill.hard': 'Hard',
  'botMode.blurb.casual': 'A mix of casual bots with their own personalities and pro bots of varying skill. You aren\'t told which is which.',
  'botMode.blurb.practice': 'Every bot is a pro. They read ranges, weigh pot odds and remember your habits at this table.',

  // mode blurb pieces
  'blurb.fateUnlimited': 'Run out of chips and you rebuy, as often as you like, so nobody is knocked out.',
  'blurb.fateNone': 'Lose your chips and you\'re out.',
  'blurb.fateCount': ({ n }) => `You're out once you've used ${plural(n, 'your 1 rebuy', `all ${n} rebuys`)}.`,
  'blurb.cash': ({ fate, unlimited }) =>
    `Fixed blinds. ${fate}${unlimited ? ' Practice for as long as you like.' : ' The game ends when one player is left.'}`,
  'blurb.deeper': ' Rebuys grow with the blinds, so you come back as deep as you started.',
  'blurb.climbTurbo': 'The blinds double every level',
  'blurb.climbStandard': 'The blinds rise about 1.5x every level',
  'blurb.timed': ({ climb, fate, deeper }) =>
    `${climb}. When time runs out, the chip leader wins. ${fate}${deeper}`,
  'blurb.tournament': ({ climb, fate, deeper, unlimited }) =>
    `${climb}. ${fate}${unlimited ? ' With nobody knocked out, it never ends by itself.' : ' The last player standing wins.'}${deeper}`,

  // join summary
  'summary.mode': 'Game mode',
  'summary.blinds': 'Blinds',
  'summary.stack': 'Starting stack',
  'summary.structure': 'Blind increase',
  'summary.fixed': 'Fixed',
  'summary.bots': 'Bots',
  'summary.botsPractice': ({ skill }) => `Practice · ${skill}`,
  'summary.botsCasual': 'Casual',
  'summary.rebuys': 'Rebuys',
  'summary.seated': 'Seated',
  'summary.seatedCount': ({ n, humans }) => `${n} (${humans} ${plural(humans, 'human', 'humans')})`,

  // invite
  'invite.title': 'Invite friends',
  'invite.lan': 'Friends on the same Wi-Fi can open the address below, or scan the QR code with their phone camera.',
  'invite.public': 'Anyone with this link can join from anywhere. Only send it to people you trust.',
  'invite.alsoLan': ({ urls }) => `On the same Wi-Fi, this works too: ${urls}`,
  'invite.noNetwork': 'This computer isn\'t connected to a network, so there\'s no address to share.',
  'invite.copy': 'Copy',
  'invite.copied': 'Address copied',
  'invite.copyBlocked': 'Copying is blocked. Press and hold the address to copy it yourself.',
  'common.close': 'Close',

  // settings
  'settings.title': 'Table settings',
  'settings.note': 'Only the host can change these. They apply once the hand is over.',
  'settings.noteGuest': 'Only the host can change the settings.',
  'settings.noteRising': 'The blinds rise on their own each level. Everything else applies once the hand is over.',
  'settings.noteHost': 'Changes apply once the hand is over.',
  'settings.sb': 'Small blind',
  'settings.bb': 'Big blind',
  'settings.stack': 'Starting stack',
  'settings.turn': 'Turn time (sec)',
  'settings.addBot': 'Add bot',
  'settings.addBotHint': 'An AI player takes an empty seat',
  'settings.endGame': 'End game and return to menu',
  'settings.endGameConfirm': 'Press again to end the game',
  'settings.endGameHint': 'Everyone stands up and the bots leave',
  'settings.save': 'Save',
  'settings.languageHint': 'Language for this screen only',

  // results
  'results.gameOver': 'Game over',
  'results.winner': ({ name }) => `${name} wins`,
  'results.hands': ({ n }) => `${n} ${plural(n, 'hand', 'hands')}`,
  'results.out': 'Out',
  'results.rebuys': ({ n }) => `Rebuys ${n}`,
  'results.newGame': 'New game',
  'results.waitHost': 'Waiting for the host',
  'reason.lastStanding': 'Last one standing',
  'reason.timeUp': 'Time\'s up',

  // chat
  'chat.toggle': 'Chat',
  'chat.placeholder': 'Message',
  'chat.paused': 'The game is paused',
  'chat.resumed': 'The game has resumed',
  'chat.joined': ({ name }) => `${name} joined`,
  'chat.returned': ({ name }) => `${name} is back`,
  'chat.left': ({ name }) => `${name} left`,
  'chat.renamed': ({ from, to }) => `${from} is now ${to}`,
  'chat.started': ({ players, bots }) =>
    `Game on: ${players} ${plural(players, 'player', 'players')} + ${bots} ${plural(bots, 'bot', 'bots')}`,
  'chat.reset': 'Game over: back to the main menu',

  // the dock
  'dock.stack': 'Stack',
  'dock.pot': 'Pot',
  'dock.rebuys': 'Rebuys',
  'dock.rebuysLeft': ({ n }) => `${n} left`,
  'dock.toCall': 'To call',
  'dock.addBot': 'Add bot',
  'dock.addBotSub': 'Start right away',
  'dock.pausedHost': 'Paused. Press Resume to carry on',
  'dock.paused': 'The game is paused',
  'dock.finished': 'The game is over',
  'dock.spectating': 'You\'re watching. Click an empty seat to sit down',
  'dock.sittingOut': 'You\'re sitting out',
  'dock.alone': 'You\'re alone. Add a bot or invite a friend',
  'dock.idle': 'The game starts with 2 or more players',
  'dock.countdown': 'Starting soon…',
  'dock.turnOf': ({ name }) => `${name}'s turn`,
  'dock.inProgress': 'In progress',
  'dock.nextHand': 'Waiting for the next hand',

  // actions
  'act.fold': 'Fold',
  'act.check': 'Check',
  'act.call': 'Call',
  'act.bet': 'Bet',
  'act.raise': 'Raise',
  'act.allIn': 'All-in',
  'act.halfPot': '½ pot',
  'act.twoThirdsPot': '⅔ pot',
  'act.pot': 'Pot',

  // seat tags & the table
  'tag.fold': 'Fold',
  'tag.check': 'Check',
  'tag.allIn': 'All-in',
  'tag.call': ({ amount }) => `Call ${amount}`,
  'tag.bet': ({ amount }) => `Bet ${amount}`,
  'tag.raise': ({ amount }) => `Raise ${amount}`,
  'tag.rebuy': 'Rebuy',
  'tag.rebuyLeft': ({ n }) => `Rebuy · ${n} left`,
  'tag.out': 'Out',
  'seat.sitHere': 'Sit here',
  'seat.addBot': '+ Add bot',
  'seat.empty': 'Empty seat',
  'seat.kick': 'Clear this seat',
  'seat.disconnected': 'Disconnected',
  'seat.sittingOut': 'Sitting out',
  'seat.waiting': 'Next hand',
  'street.preflop': 'Preflop',
  'street.flop': 'Flop',
  'street.turn': 'Turn',
  'street.river': 'River',
  'street.showdown': 'Showdown',
  'street.complete': 'Hand over',
  'status.waitingPlayers': 'Waiting for players. Invite a friend or add a bot',
  'status.waiting': 'Waiting',
  'status.wins': ({ names }) => `${names} ${names.includes(',') ? 'win' : 'wins'}`,

  // toasts
  'toast.noSeat': 'There are no empty seats',
  'toast.watching': 'You\'re watching. Click an empty seat to sit down',
  'toast.disconnected': 'Connection lost. Reconnecting…',
  'toast.rebuy': ({ stack, left }) => `Out of chips, so you rebought: stack ${stack}${left}`,
  'toast.rebuyLeft': ({ n }) => ` · ${n} left`,
  'toast.youreOut': 'You\'ve used all your rebuys and are out. Switching to spectator',
  'toast.out': ({ name }) => `${name} is out`,

  // errors from the server, by code
  'err.badInvite': 'This invite link doesn\'t work. Ask the host to send it again',
  'err.connecting': 'Still connecting',
  'err.hostOnlyPause': 'Only the host can pause the game',
  'err.hostOnlyResume': 'Only the host can resume the game',
  'err.gameAlreadyOver': 'The game is already over',
  'err.unknownPlayer': 'Unknown player',
  'err.alreadySeated': 'You\'re already seated',
  'err.noSuchSeat': 'There is no such seat',
  'err.seatTaken': 'Someone is already in that seat',
  'err.gameOver': 'The game is over',
  'err.tournamentStarted': 'The tournament has already started, so you can\'t join',
  'err.tournamentStartedBot': 'The tournament has already started, so no more bots can join',
  'err.waitForHost': 'You can sit down once the host starts the game',
  'err.hostOnlyKick': 'Only the host can clear a seat',
  'err.seatEmpty': 'That seat is empty',
  'err.kickSelf': 'Use "Stand up" to leave your own seat',
  'err.hostOnlyBot': 'Only the host can add bots',
  'err.tableFull': 'The table is full',
  'err.hostOnlyConfig': 'Only the host can change the table settings',
  'err.afterHand': 'Settings can change once the hand is over',
  'err.blindsOnClock': 'The blinds rise on a clock in this game and can\'t be set by hand',
  'err.tableOpen': 'A table is already open',
  'err.hostOnlyStart': 'Only the host can start the game',
  'err.hostOnlyReset': 'Only the host can start a new game',
  'err.notSeated': 'You\'re not seated',
  'err.noHand': 'No hand is in progress',
  'err.notYourTurn': 'It\'s not your turn yet',
  'err.isPaused': 'The game is paused',
  'err.chatEmpty': 'You can\'t send an empty message',
  'err.chatTooFast': 'Slow down a little',
};

const ko = {
  'doc.title': 'PokerMaster — 홀덤 연습 테이블',
  'lang.switch': 'English',
  'lang.switchTitle': '언어 바꾸기',

  'top.fourColor': '4색 덱',
  'top.sound': '소리',
  'top.pause': '일시정지',
  'top.resume': '재개',
  'top.invite': '친구 초대',
  'top.settings': '설정',
  'top.stand': '일어서기',
  'top.waiting': '대기 중',
  'top.hand': ({ n }) => `#${n} 핸드`,
  'top.watching': ({ n }) => `관전 ${n}명`,
  'top.blinds': ({ sb, bb }) => `블라인드 ${sb} / ${bb}`,
  'top.untilEnd': ({ time }) => `종료까지 ${time}`,
  'top.lastHand': '마지막 핸드',
  'top.nextLevel': ({ sb, bb, time }) => `다음 ${sb}/${bb} · ${time}`,
  'top.levelUpNext': '다음 핸드부터 블라인드 상승',

  'pause.title': '일시정지',
  'pause.waitHost': '호스트가 재개할 때까지 기다립니다',
  'pause.hostHint': '재개를 누르면 이어서 진행됩니다',

  'menu.tagline': '같은 와이파이에 있는 친구들과 하는 홀덤 연습 테이블',
  'menu.taglineHost': '친구가 다 모이면 시작하세요. 모두 함께 자리에 앉습니다.',
  'menu.taglineWaiting': '자리에 앉을 준비가 됐습니다. 그동안 채팅으로 이야기하세요.',
  'menu.taglineJoin': '이미 열려 있는 테이블입니다. 이름만 정하면 바로 앉습니다.',
  'menu.taglineLocked': '이미 시작된 토너먼트에는 참가할 수 없습니다. 관전은 됩니다.',
  'menu.nickname': '닉네임',
  'menu.nicknamePlaceholder': '예: 민준',
  'menu.players': ({ n, max }) => `참가자 ${n} / ${max}`,
  'menu.spectators': ({ n }) => `관전 ${n}명`,
  'menu.noSpectators': '관전 중인 사람이 없습니다',
  'menu.empty': '아직 아무도 없습니다',
  'menu.host': '호스트',
  'menu.chatPlaceholder': '메시지 보내기',
  'menu.send': '보내기',
  'menu.gameMode': '게임 방식',
  'menu.structure': '블라인드 상승 폭',
  'menu.levelLength': '상승 주기',
  'menu.totalTime': '총 시간',
  'menu.rebuys': '리바인',
  'menu.aiBots': 'AI 봇',
  'menu.fewerBots': '봇 줄이기',
  'menu.moreBots': '봇 늘리기',
  'menu.botMode': '봇 모드',
  'menu.botSkill': '봇 난이도',
  'menu.blinds': '블라인드',
  'menu.startingStack': '시작 스택',
  'menu.enter': '게임 입장',
  'menu.start': '게임 시작',
  'menu.waitHost': '호스트가 시작하기를 기다리는 중',
  'menu.join': '참가하기',
  'menu.tournamentRunning': '토너먼트 진행 중',
  'menu.noSeats': '자리가 없습니다',
  'menu.watch': '관전하기',
  'menu.minutes': ({ n }) => `${n}분`,

  'mode.tournament': '토너먼트',
  'mode.timed': '시간 제한',
  'mode.cash': '캐시 게임',
  'structure.standard': '정석',
  'structure.turbo': '터보',
  'structure.standardPreset': '정석 1.5배',
  'structure.turboPreset': '터보 2배',
  'rebuy.none': '없음',
  'rebuy.count': ({ n }) => `${n}회`,
  'rebuy.unlimited': '무제한',
  'botMode.casual': '캐주얼',
  'botMode.practice': '연습',
  'botSkill.easy': '쉬움',
  'botSkill.normal': '보통',
  'botSkill.hard': '어려움',
  'botMode.blurb.casual': '성격이 제각각인 일반 봇과 실력이 제각각인 프로 봇이 섞여 앉습니다. 누가 누군지는 알려주지 않습니다.',
  'botMode.blurb.practice': '모든 봇이 프로입니다. 레인지를 읽고 팟 오즈를 따지고, 테이블에서 당신의 버릇을 기억합니다.',

  'blurb.fateUnlimited': '칩이 떨어지면 계속 리바인해서 탈락이 없습니다.',
  'blurb.fateNone': '칩을 잃으면 바로 탈락합니다.',
  'blurb.fateCount': ({ n }) => `리바인 ${n}회를 다 쓰면 탈락합니다.`,
  'blurb.cash': ({ fate, unlimited }) =>
    `블라인드 고정. ${fate}${unlimited ? ' 끝없이 연습만 합니다.' : ' 마지막 한 명이 남으면 끝납니다.'}`,
  'blurb.deeper': ' 리바인은 블라인드가 오른 만큼 커져서 처음과 같은 깊이로 돌아옵니다.',
  'blurb.climbTurbo': '블라인드가 레벨마다 2배가 됩니다',
  'blurb.climbStandard': '블라인드가 레벨마다 1.5배씩 오릅니다',
  'blurb.timed': ({ climb, fate, deeper }) =>
    `${climb}. 정한 시간이 지나면 칩 1위가 우승합니다. ${fate}${deeper}`,
  'blurb.tournament': ({ climb, fate, deeper, unlimited }) =>
    `${climb}. ${fate}${unlimited ? ' 탈락이 없어 저절로 끝나지는 않습니다.' : ' 마지막 한 명이 우승합니다.'}${deeper}`,

  'summary.mode': '게임 방식',
  'summary.blinds': '블라인드',
  'summary.stack': '시작 스택',
  'summary.structure': '상승 폭',
  'summary.fixed': '고정',
  'summary.bots': '봇',
  'summary.botsPractice': ({ skill }) => `연습 · ${skill}`,
  'summary.botsCasual': '캐주얼',
  'summary.rebuys': '리바인',
  'summary.seated': '앉은 사람',
  'summary.seatedCount': ({ n, humans }) => `${n}명 (사람 ${humans})`,

  'invite.title': '친구 초대',
  'invite.lan': '같은 와이파이에 있는 친구가 아래 주소를 열거나, 폰 카메라로 QR을 찍으면 바로 들어옵니다.',
  'invite.public': '이 링크만 있으면 어디서든 들어올 수 있습니다. 링크를 아는 사람은 누구나 들어오니 믿는 사람에게만 보내세요.',
  'invite.alsoLan': ({ urls }) => `같은 와이파이라면 이 주소도 됩니다: ${urls}`,
  'invite.noNetwork': '이 컴퓨터가 네트워크에 연결되어 있지 않아 친구를 부를 주소를 찾지 못했습니다.',
  'invite.copy': '복사',
  'invite.copied': '주소를 복사했습니다',
  'invite.copyBlocked': '복사가 막혀 있습니다 — 주소를 길게 눌러 직접 복사해 주세요',
  'common.close': '닫기',

  'settings.title': '테이블 설정',
  'settings.note': '호스트만 바꿀 수 있고, 핸드가 끝난 뒤에 적용됩니다.',
  'settings.noteGuest': '호스트만 설정을 바꿀 수 있습니다.',
  'settings.noteRising': '블라인드는 레벨에 따라 자동으로 오릅니다. 나머지는 핸드가 끝난 뒤에 적용됩니다.',
  'settings.noteHost': '핸드가 끝난 뒤에 적용됩니다.',
  'settings.sb': '스몰 블라인드',
  'settings.bb': '빅 블라인드',
  'settings.stack': '시작 스택',
  'settings.turn': '제한 시간(초)',
  'settings.addBot': '봇 추가',
  'settings.addBotHint': '빈 자리에 AI 한 명이 앉습니다',
  'settings.endGame': '게임 끝내고 메인 메뉴로',
  'settings.endGameConfirm': '한 번 더 누르면 끝납니다',
  'settings.endGameHint': '모두 자리에서 일어나고 봇은 사라집니다',
  'settings.save': '저장',
  'settings.languageHint': '이 화면의 언어만 바뀝니다',

  'results.gameOver': '게임 종료',
  'results.winner': ({ name }) => `${name} 우승`,
  'results.hands': ({ n }) => `${n}핸드`,
  'results.out': '탈락',
  'results.rebuys': ({ n }) => `리바인 ${n}`,
  'results.newGame': '새 게임',
  'results.waitHost': '호스트를 기다리는 중',
  'reason.lastStanding': '최후의 1인',
  'reason.timeUp': '시간 종료',

  'chat.toggle': '채팅',
  'chat.placeholder': '메시지',
  'chat.paused': '게임이 일시정지되었습니다',
  'chat.resumed': '게임이 재개되었습니다',
  'chat.joined': ({ name }) => `${name} 님이 들어왔습니다`,
  'chat.returned': ({ name }) => `${name} 님이 돌아왔습니다`,
  'chat.left': ({ name }) => `${name} 님이 나갔습니다`,
  'chat.renamed': ({ from, to }) => `${from} 님이 이름을 ${to} 로 바꿨습니다`,
  'chat.started': ({ players, bots }) => `게임 시작 — ${players}명 + 봇 ${bots}명`,
  'chat.reset': '게임이 끝났습니다 — 메인 메뉴로 돌아갑니다',

  'dock.stack': '스택',
  'dock.pot': '팟',
  'dock.rebuys': '리바인',
  'dock.rebuysLeft': ({ n }) => `${n}회 남음`,
  'dock.toCall': '콜 금액',
  'dock.addBot': '봇 추가',
  'dock.addBotSub': '바로 시작하기',
  'dock.pausedHost': '일시정지 중 — 재개를 누르세요',
  'dock.paused': '일시정지 중입니다',
  'dock.finished': '게임이 끝났습니다',
  'dock.spectating': '빈 자리를 눌러 앉으세요 — 관전 중입니다',
  'dock.sittingOut': '자리 비움 상태입니다',
  'dock.alone': '혼자입니다 — 봇을 추가하거나 친구를 부르세요',
  'dock.idle': '플레이어가 2명 이상이면 시작합니다',
  'dock.countdown': '곧 시작합니다…',
  'dock.turnOf': ({ name }) => `${name} 님의 차례`,
  'dock.inProgress': '진행 중',
  'dock.nextHand': '다음 핸드를 기다리는 중',

  'act.fold': '폴드',
  'act.check': '체크',
  'act.call': '콜',
  'act.bet': '벳',
  'act.raise': '레이즈',
  'act.allIn': '올인',
  'act.halfPot': '½팟',
  'act.twoThirdsPot': '⅔팟',
  'act.pot': '팟',

  'tag.fold': '폴드',
  'tag.check': '체크',
  'tag.allIn': '올인',
  'tag.call': ({ amount }) => `콜 ${amount}`,
  'tag.bet': ({ amount }) => `벳 ${amount}`,
  'tag.raise': ({ amount }) => `레이즈 ${amount}`,
  'tag.rebuy': '리바인',
  'tag.rebuyLeft': ({ n }) => `리바인 · ${n}회 남음`,
  'tag.out': '탈락',
  'seat.sitHere': '여기 앉기',
  'seat.addBot': '+ 봇 추가',
  'seat.empty': '빈 자리',
  'seat.kick': '이 자리 비우기',
  'seat.disconnected': '연결 끊김',
  'seat.sittingOut': '자리 비움',
  'seat.waiting': '다음 핸드 대기',
  'street.preflop': '프리플랍',
  'street.flop': '플랍',
  'street.turn': '턴',
  'street.river': '리버',
  'street.showdown': '쇼다운',
  'street.complete': '핸드 종료',
  'status.waitingPlayers': '플레이어를 기다리는 중 — 친구를 부르거나 봇을 추가하세요',
  'status.waiting': '대기 중',
  'status.wins': ({ names }) => `${names} 승리`,

  'toast.noSeat': '빈 자리가 없습니다',
  'toast.watching': '관전 중입니다 — 빈 자리를 누르면 앉을 수 있습니다',
  'toast.disconnected': '연결이 끊겼습니다 — 다시 연결하는 중…',
  'toast.rebuy': ({ stack, left }) => `칩이 떨어져 리바인했습니다 — 스택 ${stack}${left}`,
  'toast.rebuyLeft': ({ n }) => ` · ${n}회 남음`,
  'toast.youreOut': '리바인을 모두 써서 탈락했습니다 — 관전으로 전환됩니다',
  'toast.out': ({ name }) => `${name} 탈락`,

  'err.badInvite': '초대 링크가 맞지 않습니다 — 주최자에게 링크를 다시 받아 주세요',
  'err.connecting': '아직 접속 중입니다',
  'err.hostOnlyPause': '호스트만 일시정지할 수 있습니다',
  'err.hostOnlyResume': '호스트만 재개할 수 있습니다',
  'err.gameAlreadyOver': '이미 끝난 게임입니다',
  'err.unknownPlayer': '알 수 없는 플레이어입니다',
  'err.alreadySeated': '이미 앉아 있습니다',
  'err.noSuchSeat': '그런 자리가 없습니다',
  'err.seatTaken': '이미 누가 앉은 자리입니다',
  'err.gameOver': '게임이 끝났습니다',
  'err.tournamentStarted': '토너먼트가 이미 시작돼서 참가할 수 없습니다',
  'err.tournamentStartedBot': '토너먼트가 이미 시작돼서 봇을 넣을 수 없습니다',
  'err.waitForHost': '호스트가 게임을 시작하면 자리에 앉을 수 있습니다',
  'err.hostOnlyKick': '호스트만 내보낼 수 있습니다',
  'err.seatEmpty': '그 자리는 비어 있습니다',
  'err.kickSelf': '자기 자신은 "일어서기"로 나가세요',
  'err.hostOnlyBot': '호스트만 봇을 추가할 수 있습니다',
  'err.tableFull': '테이블이 꽉 찼습니다',
  'err.hostOnlyConfig': '호스트만 테이블 설정을 바꿀 수 있습니다',
  'err.afterHand': '핸드가 끝난 뒤에 바꿀 수 있습니다',
  'err.blindsOnClock': '블라인드가 오르는 게임에서는 블라인드를 직접 못 바꿉니다',
  'err.tableOpen': '이미 열린 테이블이 있습니다',
  'err.hostOnlyStart': '호스트만 게임을 시작할 수 있습니다',
  'err.hostOnlyReset': '호스트만 새 게임을 시작할 수 있습니다',
  'err.notSeated': '자리에 앉아 있지 않습니다',
  'err.noHand': '진행 중인 핸드가 없습니다',
  'err.notYourTurn': '아직 차례가 아닙니다',
  'err.isPaused': '일시정지 중입니다',
  'err.chatEmpty': '빈 메시지는 보낼 수 없습니다',
  'err.chatTooFast': '조금 천천히 보내주세요',

  // The engine speaks English; these are its refusals, word for word.
  'engine.hand is over': '핸드가 끝났습니다',
  'engine.not your turn': '아직 차례가 아닙니다',
  'engine.you cannot act': '지금은 액션할 수 없습니다',
  'engine.cannot check facing a bet': '벳이 있어서 체크할 수 없습니다',
  'engine.nothing to call': '콜할 금액이 없습니다',
  'engine.you may not raise': '레이즈할 수 없습니다',
  'engine.raise must exceed the current bet': '레이즈는 현재 벳보다 커야 합니다',
};

const DICTS = { en, ko };

function stored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

let current = LANGS.includes(stored()) ? stored() : DEFAULT_LANG;
const listeners = new Set();

export function lang() { return current; }

export function has(key) { return key in DICTS[current] || key in en; }

/** Look a key up in the current language, falling back to English, then the key. */
export function t(key, params = {}) {
  const entry = DICTS[current][key] ?? en[key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(params) : entry;
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  applyStatic();
  for (const fn of listeners) fn(next);
}

export function toggleLang() {
  setLang(current === 'en' ? 'ko' : 'en');
}

export function onLangChange(fn) { listeners.add(fn); }

/**
 * Fill in the markup's fixed words: `data-i18n` for text, and
 * `data-i18n-placeholder` / `-title` / `-aria` for attributes.
 */
export function applyStatic(root = document) {
  document.documentElement.lang = current;
  document.title = t('doc.title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

/** A server refusal in the reader's language: by code, then by the engine's own words. */
export function errorText(message, code, params) {
  if (code && has(`err.${code}`)) return t(`err.${code}`, params ?? {});
  if (message && current !== 'en') {
    if (has(`engine.${message}`)) return t(`engine.${message}`);
    const min = /^minimum raise is (\d+)$/.exec(message);
    if (min && current === 'ko') return `최소 레이즈는 ${min[1]}입니다`;
  }
  return message ?? '';
}

/** A table notice in the reader's language; the server's English if the key is new to us. */
export function noticeText(message) {
  if (message.key && has(`chat.${message.key}`)) return t(`chat.${message.key}`, message.params ?? {});
  return message.text;
}
