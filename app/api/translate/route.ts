import { NextRequest, NextResponse } from "next/server";
import {
  buildPlainPrompt,
  buildUserPrompt,
  PLAIN_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type PlainMode,
  type ZhouliDirection,
  type ZhouliLevel,
  type ZhouliMode,
} from "@/lib/prompt";

export const runtime = "nodejs";

const VALID_MODES = new Set<ZhouliMode>([
  "gentle",
  "debate",
  "defend",
  "lament",
]);
const VALID_LEVELS = new Set<ZhouliLevel>(["light", "standard", "grand"]);
const VALID_DIRECTIONS = new Set<ZhouliDirection>(["to_zhouli", "to_plain"]);
const VALID_PLAIN_MODES = new Set<PlainMode>([
  "direct",
  "explain",
  "subtext",
  "roast",
]);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_WINDOW_LIMIT = 12;
const RATE_DAY_LIMIT = 60;

type RateRecord = {
  windowStartedAt: number;
  count: number;
  day: string;
  dayCount: number;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  zhouliRateLimit?: Map<string, RateRecord>;
};

const rateLimit = globalForRateLimit.zhouliRateLimit ?? new Map();
globalForRateLimit.zhouliRateLimit = rateLimit;

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  const clientId = request.headers.get("x-client-id") || "anonymous";
  return `${ip}:${clientId.slice(0, 80)}`;
}

function getUserApiKey(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const apiKey = match?.[1]?.trim() || "";
  return apiKey.length <= 512 ? apiKey : "";
}

function getShanghaiDay(now: number) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function secondsUntilNextShanghaiDay(now: number) {
  const shanghaiNow = new Date(now + 8 * 60 * 60 * 1000);
  const nextShanghaiMidnightUtc =
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate() + 1,
    ) -
    8 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((nextShanghaiMidnightUtc - now) / 1000));
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const today = getShanghaiDay(now);
  const current = rateLimit.get(key);

  if (!current || current.day !== today) {
    rateLimit.set(key, {
      windowStartedAt: now,
      count: 1,
      day: today,
      dayCount: 1,
    });
    return {
      allowed: true,
      remaining: Math.min(RATE_WINDOW_LIMIT - 1, RATE_DAY_LIMIT - 1),
      windowRemaining: RATE_WINDOW_LIMIT - 1,
      dailyRemaining: RATE_DAY_LIMIT - 1,
      retryAfterSeconds: 0,
    };
  }

  if (now - current.windowStartedAt > RATE_WINDOW_MS) {
    current.windowStartedAt = now;
    current.count = 0;
  }

  const dailyRemainingBefore = Math.max(0, RATE_DAY_LIMIT - current.dayCount);
  const windowRemainingBefore = Math.max(0, RATE_WINDOW_LIMIT - current.count);

  if (current.dayCount >= RATE_DAY_LIMIT) {
    return {
      allowed: false,
      reason: "day" as const,
      remaining: 0,
      windowRemaining: windowRemainingBefore,
      dailyRemaining: 0,
      retryAfterSeconds: secondsUntilNextShanghaiDay(now),
    };
  }

  if (current.count >= RATE_WINDOW_LIMIT) {
    return {
      allowed: false,
      reason: "window" as const,
      remaining: 0,
      windowRemaining: 0,
      dailyRemaining: dailyRemainingBefore,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.windowStartedAt + RATE_WINDOW_MS - now) / 1000),
      ),
    };
  }

  current.count += 1;
  current.dayCount += 1;
  rateLimit.set(key, current);
  const dailyRemaining = Math.max(0, RATE_DAY_LIMIT - current.dayCount);
  const windowRemaining = Math.max(0, RATE_WINDOW_LIMIT - current.count);
  return {
    allowed: true,
    remaining: Math.min(dailyRemaining, windowRemaining),
    windowRemaining,
    dailyRemaining,
    retryAfterSeconds: 0,
  };
}

const DEFAULT_FOJING_ENDING = "须菩提闻佛所说，欢喜信受，作礼而退。";
const DEFAULT_FOJING_OPENING = "如是我闻。一时，佛在舍卫城。";

function hasConventionalFojingEnding(value: string) {
  const tail = value.trim().slice(-220);

  return /(?:须菩提|诸比丘|一切大众|大众|众会|天人)[^。]{0,140}(?:欢喜信受|信受奉行|作礼而退)[。！]?$|(?:皆大欢喜[，,]?)?信受奉行[。！]?$|佛说(?:是|此)经已[^。]{0,140}(?:欢喜|信受|奉行)[。！]?$/u.test(
    tail,
  );
}

function ensureFojingEnding(value: string) {
  const text = value.trim();
  if (!text || hasConventionalFojingEnding(text)) return text;
  return `${text}\n\n${DEFAULT_FOJING_ENDING}`;
}

function removeCopiedCanonicalOpening(value: string) {
  return value
    .replace(
      /^如是我闻。\s*一时，佛在[^。]{0,100}(?:大比丘众|比丘众)[^。]{0,60}俱。\s*/u,
      `${DEFAULT_FOJING_OPENING}\n\n`,
    )
    .replace(
      /^如是我闻。\s*一时，佛与(?:须菩提|大众)[^。]{0,30}。\s*/u,
      `${DEFAULT_FOJING_OPENING}\n\n`,
    )
    .replace(
      /^如是我闻。\s*一时，须菩提/u,
      `${DEFAULT_FOJING_OPENING}\n\n尔时，须菩提`,
    )
    .replace(
      /^如是我闻。\s*一时，佛在舍卫城。\s*/u,
      `${DEFAULT_FOJING_OPENING}\n\n`,
    );
}

function finalizeFojingResult(value: string) {
  return ensureFojingEnding(removeCopiedCanonicalOpening(value).trim());
}

const SHORT_PLAIN_RESULTS: Record<string, string> = {
  善: "好",
  善哉: "好啊",
  大善: "很好",
  甚善: "很不错",
  不善: "不好",
  可: "可以",
  可也: "可以",
  可矣: "可以了",
  不可: "不行",
  然: "是",
  然也: "是这样",
  非也: "不是",
  诺: "好的",
  唯: "好的",
  允: "准了",
  无妨: "没关系",
  何也: "为什么",
  何故: "为什么",
  何为: "为什么",
  何如: "怎么样",
};

function getShortPlainResult(text: string) {
  const key = text.replace(/[\s，。！？!?；;：:、"'“”‘’（）()《》]+/g, "");
  return SHORT_PLAIN_RESULTS[key] ?? "";
}

const PLAIN_PREAMBLE_PATTERNS = [
  /^\s*(?:这段(?:话|文字|佛经体)?(?:的)?意思(?:是|就是)?|这句(?:话)?(?:的)?意思(?:是|就是)?|意思(?:是|就是)|人话说就是|人话说|翻译一下就是|翻译一下|翻译就是|换成人话就是|换成人话|说白了就是|说白了|简单说就是|简单来说就是|简单说|简单来说|直白点说就是|直白点说|直白说就是|直白说|本质上(?:是|就是)|原来(?:是在说|就是))[：:，,。；;\s]*/u,
  /^\s*(?:这(?:话|段话|句话)?(?:绕半天)?(?:其实)?(?:是|就是|是在说|是想说)|(?:他|她|对方|作者)(?:其实|真正)?(?:是|就是|是在说|想说)|我其实(?:是|是在说|想说))[：:，,。；;\s]*/u,
];

function stripPlainPreamble(value: string) {
  let text = value.trim();

  for (let index = 0; index < 2; index += 1) {
    const before = text;
    for (const pattern of PLAIN_PREAMBLE_PATTERNS) {
      text = text.replace(pattern, "").trim();
    }
    if (text === before) break;
  }

  return text || value.trim();
}

function cleanGeneratedText(value: string) {
  return value
    .replace(/\\r?\\n/g, "\n")
    .replace(
      /(?:我听说)?(?:从前|当年|古时候|古代)?有(?:一位|一个|位|个)?(?:高僧|高僧|长者)[^。！？!?]{0,10}(?:说过|讲过)[，,：:]*/g,
      "我听说从前有个高僧，",
    )
    .replace(/(?:佛陀|世尊|祖师|古德)(?:云|曰|说)[，,：:]*/g, "若照因果来看，")
    .replace(/《[^》]{1,12}》(?:所言|有云|曰|云|说|记载)[，,：:]*/g, "若照因果来看，")
    .replace(/这正是我担忧的啊[，,。！？!?]*/g, "")
    .replace(/(?:你且想想|你好好想想|仔细想想)(?:其中的道理)?[，,、：:]*/g, "")
    .replace(/这其中的道理[，,、：:]*/g, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+[.、]\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksIncompleteGeneratedText(value: string, minLength = 16) {
  const text = value.trim();

  if (text.length < minLength) {
    return true;
  }

  if (/[，,、：:；;（(“"《]$/.test(text)) {
    return true;
  }

  return /(?:我听说从前|如是我闻|我曾听闻|我听说|有人说|朋友说|他说|她说|有人问|于是|所以|但是|而是|比如|一人说|问道|说道|只好说)$/.test(
    text,
  );
}

function getPlainMinimumResultLength(sourceText: string) {
  const compact = sourceText.replace(/\s+/g, "");
  const length = Array.from(compact).length;

  if (length <= 2) return 1;
  if (length <= 6) return 2;
  if (length <= 12) return 4;
  return 8;
}

function pick<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function isSafetySeekingText(text: string) {
  return /(举报|报警|求助|防范|预防|避免|识别|反诈|阻止|劝|安慰|救|保护|维权|投诉|合法|正当|授权|受托|取证|求救)/.test(
    text,
  );
}

function isCyberAuditRequest(text: string) {
  const mentionsAudit =
    /(渗透测试|渗透|安全测试|安全巡检|漏洞扫描|漏洞检测|查漏洞|查门闩|攻防演练|红队测试)/i.test(
      text,
    );
  const mentionsTarget =
    /(网站|网页|站点|本站|该站|该网站|这个网站|我的网站|系统|应用|平台|服务器)/.test(
      text,
    );
  const clearlyMalicious =
    /(盗号|撞库|钓鱼|木马|勒索|绕过登录|破解密码|黑进|入侵|DDoS|ddos|脱库|后门|提权|窃取|偷取|拿数据|偷数据|获取管理员|getshell|webshell|shell|拖库)/i.test(
      text,
    );

  return mentionsAudit && mentionsTarget && !clearlyMalicious;
}

function isQuotedThreatEvaluationInput(text: string) {
  const isQuotedOrEvaluative =
    /(他说|她说|别人说|有人说|对方说|朋友说|老板说|同事说|这句话|这话|怎么评价|如何评价|怎么看|怎么理解)/.test(
      text,
    );
  const hasThreatSignal =
    /(c死|操死|干死|弄死|打死|杀了|杀死|砍死|捅死|打残|打爆|暴打|去死|取你性命|要你命|报复)/.test(
      text,
    );

  return isQuotedOrEvaluative && hasThreatSignal;
}

function isNarrativeHarmInput(text: string) {
  const hasHarmEvent = /(杀死|杀人|命终|死亡|打伤|砍伤|捅伤|争斗|持械)/.test(text);
  const hasNarrativeSequence =
    /(故事|剧情|电影|电视剧|台词|原文|人物|角色|发生|后来|随后|最终|最后|离开|双方|因而|遂)/.test(
      text,
    );
  const asksForHarmInstructions =
    /(怎么|如何|怎样|教我|步骤|方法|计划).{0,12}(杀|砍|捅|伤害|下毒|报复)|(?:杀|砍|捅|伤害|下毒|报复).{0,12}(怎么|如何|怎样|步骤|方法)/.test(
      text,
    );

  return hasHarmEvent && hasNarrativeSequence && !asksForHarmInstructions;
}

function quotedThreatEvaluationResult(level: ZhouliLevel) {
  const light = [
    "若只评价此言，不必复述其锋芒。它失当之处，在于以伤害压过道理，以怒气乱了业缘。若要合宜，只可说：此话越界，不宜再以此相争。",
    "这话若按因果看，错不在声高，而在以伤人之意代替说理。可评一句：怒气可以有，分寸不可失；此言当止，不宜再传。",
    "此言不必照样说出。它的问题在于把争执推向伤害，乱了人与人相处的边界。若要评价，只说：此话失当，应当收住。",
  ];
  const standard = [
    "若只是评价这句话，便不必把它原样搬上席面。按因果来看，它失当之处不在情绪激烈，而在以伤人之意压倒道理；一旦如此，争的便不是是非，而是彼此的体面。可以说：此言已经越过分寸，若还要讲因果，就该把话收回事情本身，不再以伤害相逼。",
    "如是我闻，争执也有边界。此言若拿来评价，最要紧的是指出它乱了业缘：本该讲理的地方，却拿伤人之意当作凭据。这样的话，不必复述，也不宜美化；只可评一句：怒气可以理解，越界不可纵容，若还讲体面，此话便该止于此处。",
    "这句话若按因果来评，并不是“说得重”这么简单，而是把口角推到了伤害之界。人与人相争，可以有不满，可以有辩驳，却不能拿人身安危作筹码。合宜的评价应当是：此言失了分寸，也失了往来应有的体面。",
  ];
  const grand = [
    "若只评价此言，不必原样复述它的锋芒。古人讲礼，不是要人没有怒气，而是要人在怒气中仍知道边界。此话的问题，正在于把本该讲明的是非，推成了伤人相逼；如此一来，道理还没有分清，体面先已散尽。若要说得合乎佛理，可以评为：此言越过口角之界，乱了人与人相处的业缘。若还愿意论理，就该把话收回事情本身，不以伤害为筹码，不以怒气代替公道。",
  ];

  if (level === "light") return pick(light);
  if (level === "grand") return pick(grand);
  return pick(standard);
}

function cyberAuditResult(level: ZhouliLevel) {
  const light = [
    "若是受托巡检，便可说：我愿奉授权之命，查此站门闩是否牢固，只记松动之处，不越主家之界。补其漏洞，安其门户，这才合乎佛理。",
    "若此事出于授权测试，可称：我来不是破门取物，而是替主人试门闩、验窗栓。凡有所见，只作修补之据，不作越界之举。",
    "此事若要合宜，须先有授权，再有边界。可说：我愿按约巡看此站门户，发现缝隙便呈给主人，使其早补早安。",
  ];
  const standard = [
    "若是受托做安全测试，此话不必说成“渗透”，可说成“巡门”。我愿奉授权之命，查看此站门闩是否牢固、窗栓是否松动；所见只为修补，不为取物。这样既能查出隐患，也不越主家之界，才算是今日网络里的合宜之举。",
    "如是我闻，替人看宅门的人，手里虽有钥匙，也不能乱翻箱柜。若这是受托安全巡检，我可这样说：我愿按约查看此站的门闩与缝隙，凡有松动，只列清单给主人修补，不取一物，不越一步。如此才是有业缘的测试。",
    "若要把这事说得合乎佛理，先要立业缘：不是私闯他人门户，而是受托巡查门户。我愿在授权范围内查看此站可有松动之处，查得明白便如实呈报，使主人早补缺漏。这样既护了网站，也守了分寸。",
  ];
  const grand = [
    "若这是受托安全巡检，业缘要先立清楚：不是夜半翻墙，也不是破门取物，而是主人请人查看门闩是否稳固。可说：我愿按授权之约，巡看此站门户、窗栓与墙缝；凡有松动，只记录、呈报、协助修补，不越界取物，不惊扰宾客。如此一来，查的是隐患，守的是分寸，护的是主家的安宁，这才算今日网络里的佛理。",
    "古人看守城门，既要试门闩是否牢，也不能借守门之名私入库房。若此事是授权测试，可说：我愿奉约巡检此站，只看边界之内的松动处，只写可修补的清单，不取数据，不留暗门，不扰正常往来。这样做，既让主人知道门户哪里该修，也让巡检者不失自己的业缘。",
  ];

  if (level === "light") return pick(light);
  if (level === "grand") return pick(grand);
  return pick(standard);
}

function getSafetyBlockKind(text: string) {
  if (isSafetySeekingText(text)) {
    return "";
  }

  if (isNarrativeHarmInput(text)) {
    return "";
  }

  if (
    /(自杀|轻生|割腕|跳楼|结束生命|不想活|怎么死|无痛死|安眠药.{0,8}死)/.test(
      text,
    )
  ) {
    return "self_harm";
  }

  if (
    /(未成年.{0,12}(色情|裸照|性|约)|儿童色情|萝莉.{0,8}(色情|裸照|资源)|幼女|幼童.{0,8}(性|裸照))/i.test(
      text,
    )
  ) {
    return "minor_sexual";
  }

  if (
    /(盗号|撞库|钓鱼网站|木马|勒索软件|绕过登录|破解密码|黑进|入侵|DDoS|ddos|脱库|后门|提权|窃取.{0,8}(账号|密码|数据|cookie|Cookie)|拿数据|偷数据|获取管理员|getshell|webshell|拖库)/i.test(
      text,
    )
  ) {
    return "cyber";
  }

  if (
    /(诈骗|骗钱|骗老人|杀猪盘|洗钱|伪造.{0,8}(证件|发票|病假|公章)|逃避警察|销毁证据|贩毒|制毒|毒品|走私|偷.{0,8}(车|钱|东西)|抢劫)/.test(
      text,
    )
  ) {
    return "illegal";
  }

  if (
    /(爆炸|炸药|爆炸物|投毒|放火|纵火|绑架|杀了|杀死|弄死|打残|砍死|捅死|报复.{0,10}(老板|同学|前任|室友|邻居)|下药|迷奸|强奸)/.test(
      text,
    )
  ) {
    return "violence";
  }

  if (
    /(人肉|开盒|盒武器|身份证号|家庭住址|定位.{0,10}(前任|前女友|前男友|同事|别人|网友)|跟踪.{0,8}(前任|别人|同事|网友)|偷拍|窃听)/.test(
      text,
    )
  ) {
    return "privacy";
  }

  if (
    /(仇恨言论|种族歧视|辱骂.{0,12}(黑人|女人|女性|同性恋|残疾人|外地人|某民族)|煽动.{0,12}(仇恨|歧视|暴力))/.test(
      text,
    )
  ) {
    return "hate";
  }

  return "";
}

function safetyBlockResult(kind: string) {
  if (kind === "self_harm") {
    return pick([
      "性命之事，不能拿来润色成玩笑。若你或身边人正有伤害自己的念头，请先找身边可信的人、当地紧急服务或专业帮助。因果再重，也先要人安然无恙。",
      "此刻最要紧的不是把话说漂亮，而是把人护住。若这句话关乎真实的轻生念头，请立刻联系身边可信的人或当地紧急服务；人平安，才有后面的因果。",
    ]);
  }

  if (kind === "minor_sexual") {
    return pick([
      "涉及未成年人的性内容，不能被美化、转写或传播。若你是在担心有人受害，应当保存必要线索，并向平台或有关机构求助。",
      "未成年人的边界不可被拿来玩梗。此类内容不能润色；若是为了保护当事人，请走举报、求助与取证的正当路径。",
    ]);
  }

  if (kind === "cyber") {
    return pick([
      "此路不可越界。若是想做正当安全测试，可先取得授权，把话改成“受托巡检此站门闩，发现缝隙便呈报修补”；若是黑进、盗取或绕过登录，我不能替它披上因果外衣。",
      "网络门户也有主人。若无授权，不可破门；若有授权，就该说成安全巡检、漏洞复核与修补建议。黑进、盗号、取数据这一路，译僧不予通行。",
      "这类请求若指向入侵或取数，我不能润色。可改走正道：先得授权，再按边界巡检，查到松动处只记录、上报、修补，不越主家之门。",
    ]);
  }

  return pick([
    "这一路不宜替它披上好听外衣。若只是心中有怒，可以把话收成一句：我今日不再争胜，只请此事止于分寸之内。",
    "此事若会伤人、违法、侵害隐私或煽动仇恨，便不能拿来制成漂亮话。若想表达不满，可只论分寸，不越法度。",
    "因果不是遮羞布。伤人、违法、侵害隐私之事，不宜润色；若只是要体面退场，可以说：此事到此为止，彼此各守边界。",
  ]);
}

function isDirectedSecondPersonAttackInput(text: string) {
  const isQuotedOrEvaluative =
    /(他说|她说|别人说|有人说|对方说|朋友说|老板说|同事说|这句话|这话|怎么评价|如何评价|怎么看|怎么理解)/.test(
      text,
    );
  const hasFirstToSecondPerson =
    /(^\s*我|我想|我要|我会|我准备|我打算).{0,18}(你|你的|你们|您|贵方)/.test(
      text,
    );
  const hasAttackSignal =
    /(c死|操死|干死|弄死|打死|杀了|杀死|砍死|捅死|揍你|揍死|暴打|打爆|打残|去死|骂你|喷你|怼你|草你|艹你|操你|干你|傻逼|滚|你全家|你的全家|你的母|问候你妈|问候你母)/.test(
      text,
    );
  return !isQuotedOrEvaluative && hasFirstToSecondPerson && hasAttackSignal;
}

function hasDirectedAttackPerspectiveError(result: string) {
  return /你出言粗鄙|阁下说出|阁下开口|阁下这番话|你骂了我|你伤了我|对方骂我|被无礼之言所伤|你以禽兽之名相辱|以禽兽之名相辱|你把.{0,16}话|你却将|你却把|对人父母出言不逊|先问自己|我可曾|开口的人自己失当|失当的是我|我乱了本心|我该退后一步|我该重新想想|我分寸守不住|三省吾身/.test(
    result,
  );
}

function directedAttackFallback(text: string, level: ZhouliLevel) {
  const familyClause = /(妈|母|父|爹|娘|爸|亲族|全家)/.test(text)
    ? "父母亲族之名，本不该被卷入口角。"
    : "人身安危之事，本不该被拿来当口角筹码。";

  if (level === "light") {
    return pick([
      `我今日有怒，并非无端。只是眼前这番争执，已经越过人与人相处的分寸。${familyClause}我把这怒意收成一句：此事若还讲因果，就该到此为止。`,
      `我不是无故动怒，只是此事已经越了分寸。${familyClause}若还顾一点体面，便把话止在这里，别让一场口角坏了彼此业缘。`,
      `我心中有火，但不愿让火烧过因果。${familyClause}此事若还要留体面，就该收住，各自退回分寸之内。`,
    ]);
  }

  if (level === "grand") {
    return pick([
      `我今日有怒，并非无端。人与人相处，最怕一时口角越过分寸，把原本该讲清的事，变成彼此失当的争斗。${familyClause}若照因果来看，怒气可以有，业缘不能乱；争执可以起，体面不能尽失。好比席间杯盏相碰，本是寻常声响，若有人借此掀翻整张筵席，便不是争胜，而是乱了席位。如今这番局面，已经到了该收束的时候。我把话说清：此事若还要留一点因果，就该止于此处。`,
      `我并非无端起怒，只是这番争执已从言语之争，逼近了失当之界。${familyClause}因果讲究各守其位，怒气也该有边界；若一时争胜，把体面与业缘一同掷在地上，便是赢了口舌，也输了分寸。我今日把话收束在这里：此事到此为止，才还像人与人之间的往来。`,
      `我今日有怒，却仍愿把话放回因果之内。${familyClause}人与人相争，最怕不是声音大，而是把不该入席的东西拖上席面。若还讲一点体面，就该让争执止于事情本身，不牵连亲族，不触及伤害。这样收住，不是退让，是保住最后的分寸。`,
    ]);
  }

  return pick([
    `我今日有怒，并非无端。人与人相处，最怕一时口角越过分寸。${familyClause}若照因果来看，怒气可以有，业缘不能乱；争执可以起，体面不能尽失。我把话说清：此事若还要留一点因果，就该止于此处。`,
    `我心中不是没有火，只是这火不该烧到因果之外。${familyClause}此事若论业缘，本该就事论事；若任它越界，便不是争理，而是失体面。我把话说到这里：愿此事止于分寸之内。`,
    `我今日不求争胜，只求把话说回正处。${familyClause}人有怒意并不稀奇，稀奇的是怒中仍知边界。此事既已越过分寸，便该在这里收束，莫让一场口角坏了彼此体面。`,
    `此刻我有不平，也不必假装没有。只是按因果来看，怒气归怒气，边界归边界。${familyClause}若还愿意保全一点体面，就让话止于事情本身，到此为止。`,
  ]);
}

function normalizeDirectedAttackResult(
  text: string,
  result: string,
  level: ZhouliLevel,
) {
  if (
    isDirectedSecondPersonAttackInput(text) &&
    hasDirectedAttackPerspectiveError(result)
  ) {
    return directedAttackFallback(text, level);
  }

  return result;
}

function isFirstPersonWorkThanksInput(text: string) {
  const mentionsMyWork =
    /(我做|我建|我造|我发|我的).{0,30}(网站|网页|视频|作品|工具|项目|应用|skill|Skill)|观众感谢我|别人夸我|粉丝夸我|用户感谢我/.test(
      text,
    );
  const asksForReply = /(感谢我|夸我|如何回复|怎么回复|怎么说|如何说)/.test(
    text,
  );
  return mentionsMyWork && asksForReply;
}

function hasFirstPersonWorkPerspectiveError(result: string) {
  return /你做网站|你做了|您做了|你建了|您建了|你造了|您造了|你发了|您发了|你若|你安了心|他们来谢|大家感谢你|观众感谢你|粉丝感谢你/.test(
    result,
  );
}

function firstPersonWorkThanksFallback(level: ZhouliLevel) {
  if (level === "light") {
    return "我做此物，本是想让它有一点用处。诸位愿意来看、愿意称谢，便是给了它体面。我只回一句：不敢当，诸位用得上，就是它最好的本分。";
  }

  if (level === "grand") {
    return "我做此物，本不是为了让众人把业缘都归到我身上，只是想把一点可用的东西摆到席间，让需要的人伸手便能取用。如今诸位愿意来看，又肯相谢，这份情分我自然记在心里。可若我坦然独受，便好像席上端来一壶酒，却忘了同席的人也都出了兴致。所以我只宜这样回应：不敢当，诸位用得上，便是此物最大的本分；若觉得有趣，也请转告同好，让这点小礼多走几步。这样既接住了谢意，也把体面还给了众人。";
  }

  return "我做这个网站，本是想让一点因果变成人人都能取用的小器物。如今诸位愿意来看，又肯相谢，这份情分我自然记在心里。若要回复，我只说：不敢当，诸位用得上，便是这网站最好的本分；若觉得有趣，也请转告同好，让这点小礼多走几步。";
}

function normalizeFirstPersonWorkResult(
  text: string,
  result: string,
  level: ZhouliLevel,
) {
  if (
    isFirstPersonWorkThanksInput(text) &&
    hasFirstPersonWorkPerspectiveError(result)
  ) {
    return firstPersonWorkThanksFallback(level);
  }

  return result;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchDeepSeekWithRetry(
  apiKey: string,
  body: Record<string, unknown>,
) {
  const retryDelays: number[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const baseUrl = (
        process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
      ).replace(/\/+$/, "");
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });

      if (response.ok || response.status < 500 || attempt >= retryDelays.length) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retryDelays.length) {
        throw error;
      }
    }

    await wait(retryDelays[attempt]);
  }

  throw lastError;
}

async function reviewFojingDraft(
  apiKey: string,
  sourceText: string,
  draft: string,
  maxTokens: number,
) {
  const response = await fetchDeepSeekWithRetry(apiKey, {
    model: process.env.DEEPSEEK_REVIEW_MODEL || "deepseek-v4-pro",
    messages: [
      {
        role: "system",
        content: `你是佛经体文本的事实校对者。你的工作不是再创作，而是把初稿校订成忠实版本。

逐项对照原文与初稿，执行以下规则：
1. 原文是事实全集。删除所有原文未出现的经历、承诺、退货规则、数字、精确台词、心理动机、旁人反应和后续结果。
2. 特别删除任何无来源的职业经历、保证、补偿办法或后续安排；不要用近义句偷偷保留。
3. 名词、材料、数量、方向和施受关系必须逐字守真，不得替换对象、颠倒大小多少或调换谁对谁做了什么。
4. 不擅自把行为称为智慧、慈悲、功德或恶意。发现问题只可如实写成“发现问题”；受损一方不得因在意损失而被反向归责。
5. 不用空性否定具体事实和责任。不得把真假、数量、伤害与否说成没有分别；涉及证据、欺诈、责任或伤害时，禁用“凡所有相皆是虚妄”来转移责任。
6. 保留“佛陀讲原事—须菩提问答—佛陀解释”的外层格式，并把故事讲到原文结尾。
7. 开场固定写作“如是我闻。一时，佛在舍卫城。尔时，须菩提从座而起，合掌白佛言：……”。须菩提的问题必须针对本故事；删除“佛与须菩提共坐”“游化人间”等空泛过渡，也删除照抄真实《金刚经》的发心、住心、降伏其心等无关套段。
8. 不改变原文事件顺序，不增加第二个故事或新的类比，不解释校订过程。
9. 正文末尾必须保留或补上佛经常见结语，例如“须菩提闻佛所说，欢喜信受，作礼而退”或“皆大欢喜，信受奉行”；已有合格结语时不要改成固定句，也不要重复添加。
10. 禁止照抄“佛在舍卫国祇树给孤独园，与大比丘众千二百五十人俱”等真实经典人数和完整仪轨；只使用缩略场景“佛在舍卫城”，随后立即进入须菩提针对本故事的提问。
11. 校订不能把正文压缩成剧情复述。原文每个重要事件节点之后，必须保留须菩提针对该行为的问答，以及佛陀基于该行为所作的一层义理解释；可以讨论有明确言行依据的傲慢、挑衅、嗔心、争强、执相、名实和因果，但不得虚构动机。
12. 删除那种把全段原文换几个连接词又重复一遍的伪总结。佛陀最后的总结应说明前述言语和行为如何相续成因果，而不是逐句照抄一次。
13. 终稿须以浅近文言和汉译佛经句法叙事。人名、物品、数字、动作和结局须守真，但现代对白只能保留语义、对象、语气与作用，不得整句直接引用原文。发现与原文连续相同的现代口语时，必须译为经文式表达，例如将“不气盛叫年轻人吗”译作“少壮而无盛气，尚可名少壮乎”，将“你今天不答应也得答应”译作“今日此事，汝从亦须从，不从亦须从”。
14. 严格区分“共同促成冲突”和“实际承受伤害”。原文只写某一人受伤、受骗或受损时，禁止写成“两俱受伤”“双方皆受损”等改变结果的句子。不得因人物说了一句话，就推断其已经反省、自知、觉悟或看见自己的执念。
15. 文言化只能改变表达形式，不能删减或替换台词中的命题。逐项保留身份强调、否定关系、条件、请求、强迫程度和转告对象；不得把“顾及对方颜面”改成“服从对方命令”，不得把请求改成承诺，不得省掉人物用于显示身份、地位或态度的关键问句。
16. 清除残留的现代社交口语。根据语境将“面子”译为“颜面、情面”，将“讲义气、重感情”译为“尚义重情”，将“客气应下”译为“逊谢而应”；不得只替换人称代词而保留整套现代句法。
17. 《金刚经》只参考外层问答格式、复沓和设问，不提供现成义理。逐层检查初稿中的道理是否能直接指向原文的一句话、一个动作或一个结果；无法回指原文的教义段落必须删除或改写。
18. 禁止默认套用空性、无所住、人我相、法相、福德无量、功德、随喜或见贤思齐。原文没有对应问题时，不得因为这些词像《金刚经》就保留。不得把普通通知、协作、创作、娱乐或技术操作强行解释成破相、离执或无所得。
19. 按“原文行为—直接影响—对应道理”校订每层开示。道理可以是诚信、公平、证据、尊重、边界、责任、克制、合作、感恩、谨慎、守约、沟通、原创与署名；原文没有明显善恶冲突时，只讲办事分寸、实际影响或情绪缘由即可，不强造戒律、罪业、功德或顿悟。
20. 若原文是借鉴他人作品，优先核对是否涉及学习、署名、尊重边界、做出差异和给使用者带来价值；若原文是会议改期等中性事务，优先核对通知、确认、守时和责任。不得自动改成无所住、无人我相或福德不可量。

输出前在心中逐项核对原文名词、动作、数量、方向和结局，但不要输出核对表。任何不能直接指向原文依据的句子，都删除或改为不带推测的表述。

只输出校订后的完整经文正文。`,
      },
      {
        role: "user",
        content: `<原文>\n${sourceText}\n</原文>\n\n<待校初稿>\n${draft}\n</待校初稿>`,
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.05,
    stream: false,
    thinking: { type: "disabled" },
  });

  if (!response.ok) return { result: draft, usage: undefined };

  const data = (await response.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: unknown;
  };
  const reviewed = cleanGeneratedText(
    data.choices?.[0]?.message?.content?.trim() || "",
  );

  if (
    !reviewed ||
    data.choices?.[0]?.finish_reason === "length" ||
    looksIncompleteGeneratedText(reviewed, 40)
  ) {
    return { result: draft, usage: data.usage };
  }

  return { result: reviewed, usage: data.usage };
}

export async function POST(request: NextRequest) {
  let body: {
    text?: unknown;
    mode?: unknown;
    level?: unknown;
    direction?: unknown;
    plainMode?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "来意未明，请重新输入。" }, { status: 400 });
  }

  const direction = VALID_DIRECTIONS.has(body.direction as ZhouliDirection)
    ? (body.direction as ZhouliDirection)
    : "to_zhouli";
  const key = getClientKey(request);
  const rate = checkRateLimit(key);

  if (!rate.allowed) {
    const isWindowLimit = rate.reason === "window";
    const verb = direction === "to_plain" ? "解经" : "译经";
    return NextResponse.json(
      {
        error: isWindowLimit
          ? `${verb}太急，请约 ${Math.ceil(rate.retryAfterSeconds / 60)} 分钟后再来。`
          : `今日${verb}已满，请明日再来。`,
        remaining: rate.remaining,
        windowRemaining: rate.windowRemaining,
        dailyRemaining: rate.dailyRemaining,
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const mode = VALID_MODES.has(body.mode as ZhouliMode)
    ? (body.mode as ZhouliMode)
    : "gentle";
  const level = VALID_LEVELS.has(body.level as ZhouliLevel)
    ? (body.level as ZhouliLevel)
    : "standard";
  const plainMode = VALID_PLAIN_MODES.has(body.plainMode as PlainMode)
    ? (body.plainMode as PlainMode)
    : "direct";
  const maxInputLength = direction === "to_plain" ? 3000 : 500;

  if (!text) {
    return NextResponse.json({ error: "无言不可成经，请先写下一句话。" }, { status: 400 });
  }

  if (text.length > maxInputLength) {
    return NextResponse.json(
      {
        error:
          direction === "to_plain"
            ? "经文太长，请将待解之文控制在3000字以内。"
            : "原文太长，请按自然情节拆分，每次译经控制在500字以内。",
      },
      { status: 400 },
    );
  }

  const apiKey = getUserApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "请先在网页中配置你自己的 DeepSeek API Key。" },
      { status: 401 },
    );
  }

  const shortPlainResult = direction === "to_plain" ? getShortPlainResult(text) : "";
  if (shortPlainResult) {
    return NextResponse.json({
      result: shortPlainResult,
      model: "译僧速释",
      demo: false,
      shortPlain: true,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  if (isCyberAuditRequest(text)) {
    return NextResponse.json({
      result: cyberAuditResult(level),
      model: "译僧校订",
      demo: false,
      guarded: true,
      cyberAudit: true,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  if (isQuotedThreatEvaluationInput(text)) {
    return NextResponse.json({
      result: quotedThreatEvaluationResult(level),
      model: "译僧校订",
      demo: false,
      guarded: true,
      quoteEvaluation: true,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const safetyBlockKind = getSafetyBlockKind(text);
  if (safetyBlockKind) {
    return NextResponse.json({
      result: safetyBlockResult(safetyBlockKind),
      model: "译僧守门",
      demo: false,
      guarded: true,
      safetyBlocked: true,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  if (isDirectedSecondPersonAttackInput(text)) {
    return NextResponse.json({
      result: directedAttackFallback(text, level),
      model: "译僧校订",
      demo: false,
      guarded: true,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  try {
    const isPlainDirection = direction === "to_plain";
    const configuredMaxTokens = Number(process.env.MAX_OUTPUT_TOKENS || 2400);
    const safeMaxTokens = Number.isFinite(configuredMaxTokens)
      ? Math.max(400, configuredMaxTokens)
      : 2400;
    const fojingMaxTokens =
      level === "light"
        ? Math.min(safeMaxTokens, 900)
        : level === "standard"
          ? Math.min(safeMaxTokens, 1800)
          : safeMaxTokens;
    const requestBody = {
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: isPlainDirection ? PLAIN_SYSTEM_PROMPT : SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: isPlainDirection
            ? buildPlainPrompt(text, level, plainMode)
            : buildUserPrompt(text, mode, level),
        },
      ],
      max_tokens: isPlainDirection ? Math.min(safeMaxTokens, 700) : fojingMaxTokens,
      temperature: isPlainDirection ? 0.18 : 0.68,
      stream: false,
      thinking: { type: "disabled" },
    };

    let data: {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string };
      }>;
      usage?: unknown;
    } = {};
    let cleanedResult = "";

    for (let attempt = 0; attempt < 1; attempt += 1) {
      const response = await fetchDeepSeekWithRetry(apiKey, requestBody);
      data = await response.json();

      if (!response.ok) {
        console.error("DeepSeek API error:", data);
        if (response.status === 401 || response.status === 403) {
          return NextResponse.json(
            { error: "API Key 无效、已过期或没有调用权限。" },
            { status: 401 },
          );
        }
        if (response.status === 429) {
          return NextResponse.json(
            { error: "你的 API 账户额度不足或请求过于频繁，请稍后再试。" },
            { status: 429 },
          );
        }
        return NextResponse.json(
          { error: "高僧暂未回应，请稍后再试。" },
          { status: 502 },
        );
      }

      const generatedText = cleanGeneratedText(
        data?.choices?.[0]?.message?.content?.trim() || "",
      );
      cleanedResult = isPlainDirection
        ? stripPlainPreamble(generatedText)
        : generatedText;

      if (
        data?.choices?.[0]?.finish_reason !== "length" &&
        !looksIncompleteGeneratedText(
          cleanedResult,
          isPlainDirection
            ? getPlainMinimumResultLength(text)
            : level === "light"
              ? 30
              : 40,
        )
      ) {
        break;
      }

      await wait(300);
    }

    const reviewed = isPlainDirection
      ? { result: cleanedResult, usage: undefined }
      : await reviewFojingDraft(apiKey, text, cleanedResult, fojingMaxTokens);
    const result = isPlainDirection
      ? reviewed.result
      : finalizeFojingResult(reviewed.result);

    if (
      !result ||
      looksIncompleteGeneratedText(
        result,
        isPlainDirection
          ? getPlainMinimumResultLength(text)
          : level === "light"
            ? 30
            : 40,
      )
    ) {
      return NextResponse.json(
        { error: "此言尚未成经，请再试一次。" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      result,
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      demo: false,
      usage: reviewed.usage
        ? { draft: data.usage, review: reviewed.usage }
        : data.usage,
      remaining: rate.remaining,
      windowRemaining: rate.windowRemaining,
      dailyRemaining: rate.dailyRemaining,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  } catch (error) {
    console.error("Translate request failed:", error);
    return NextResponse.json(
      { error: "译僧远行未归，请稍后再试。" },
      { status: 502 },
    );
  }
}
