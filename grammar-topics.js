// Turkse grammatica-taxonomie voor Türkçe Öğren.
// Uitgesplitst uit index.html zodat dit los gecached kan worden en index.html overzichtelijk
// blijft. Wordt vóór het hoofdscript ingeladen via <script src="grammar-topics.js"></script>,
// dus GRAMMAR_TOPICS staat al klaar als global tegen de tijd dat het hoofdscript het gebruikt.
/* ===================== GRAMMATICA-TAXONOMIE ===================== */
// Vaste lijst Turkse grammaticale onderwerpen (A1 t/m C1/C2), die de app zelf kan volgen
// en gericht kan invlechten in gegenereerde zinnen/vragen — los van losse woordenschat.
const GRAMMAR_TOPICS = [
  {key:"copula_basic",     label:"Copula — singular forms (\"to be\" as a suffix)", hint:"ONLY singular persons: ben/sen/o (I am / you are / he-she-it is), attached to a noun or adjective predicate — e.g. \"öğretmenim\" (I am a teacher), \"iyisin\" (you are good). Do NOT use plural persons (biz/siz/onlar) here.", minCefr:0,
    variants: [
      {id:"ben", hint:"1st person singular \"ben\" (I am) — e.g. \"öğretmenim\" (I am a teacher)"},
      {id:"sen", hint:"2nd person singular \"sen\" (you are) — e.g. \"iyisin\" (you are good)"},
      {id:"o",   hint:"3rd person singular \"o\" (he/she/it is) — e.g. \"öğretmen\" (he/she is a teacher — often no visible suffix in 3rd person)"},
    ]},
  {key:"copula_plural",    label:"Copula — plural forms & buffer letters", hint:"ONLY plural persons: biz/siz/onlar (we are / you[pl.] are / they are), attached to a noun or adjective predicate — e.g. \"öğretmeniz\" (we are teachers), \"mutlular\" (they are happy). Vary which vowel-harmony/buffer-letter variant of the ending is used across different examples. Do NOT use singular persons (ben/sen/o) here.", minCefr:0,
    variants: [
      {id:"biz",    hint:"1st person plural \"biz\" (we are) — e.g. \"öğretmeniz\" (we are teachers)"},
      {id:"siz",    hint:"2nd person plural/formal \"siz\" (you[pl./formal] are) — e.g. \"iyisiniz\" (you are well)"},
      {id:"onlar",  hint:"3rd person plural \"onlar\" (they are) — e.g. \"mutlular\" (they are happy)"},
    ]},
  {key:"copula_soru_olumsuz", label:"Copula — questions & negation", hint:"EITHER a yes/no question using the copula with the mi/mı/mu/mü particle placed correctly BEFORE the personal ending (e.g. \"öğretmen misin?\" = are you a teacher?), OR a negative statement using değil (e.g. \"öğretmen değilim\" = I am not a teacher). Any grammatical person is fine here — the focus is the question/negation mechanic, not the person.", minCefr:1,
    // Was "EITHER...OR" in één hint gebundeld -- dat leidt er (net als bij isaret_zamirleri) toe dat het
    // model bijna altijd naar dezelfde helft van de EITHER/OR trekt.
    variants: [
      {id:"soru",     hint:"yes/no question with mi/mı/mu/mü BEFORE the personal ending — e.g. \"öğretmen misin?\" (are you a teacher?)"},
      {id:"olumsuz",  hint:"negative statement using değil — e.g. \"öğretmen değilim\" (I am not a teacher)"},
    ]},
  {key:"olumsuzluk",      label:"Negation (-me/-mi, değil)",         hint:"e.g. \"gitmiyorum\" (I'm not going), \"iyi değil\" (not good)", minCefr:0},
  {key:"soru_eki",        label:"Question particle mi/mı/mu/mü",    hint:"e.g. \"geldin mi?\" (did you come?) — vary which of the four vowel-harmony forms (mi/mı/mu/mü) comes up across repeated exercises, rather than always the same one", minCefr:0},
  {key:"cogul_eki",       label:"Plural (-ler/-lar)",                hint:"e.g. \"kitaplar\" (books) — vary which of the two vowel-harmony forms (-ler/-lar) comes up across repeated exercises, rather than always the same one", minCefr:0},
  {key:"simdiki_zaman",   label:"Present continuous -iyor",          hint:"e.g. \"geliyorum\" (I'm coming)", minCefr:0},
  {key:"mastar",          label:"Infinitive -mek/-mak",              hint:"e.g. \"gitmek istiyorum\" (I want to go)", minCefr:1},
  {key:"sayilar_siralar", label:"Numbers & ordinals (-inci)",        hint:"e.g. \"üçüncü\" (third)", minCefr:1,
    variants: [
      {id:"kardinal", hint:"cardinal numbers — e.g. \"üç kitap\" (three books)"},
      {id:"ordinal",  hint:"ordinal numbers with -inci — e.g. \"üçüncü\" (third)"},
    ]},
  {key:"iyelik_ekleri",   label:"Possessive suffixes",               hint:"my/your/his..., e.g. \"evim, evin, evi\" (my/your/his house)", minCefr:1,
    // Hint hierboven toonde alleen enkelvoud (evim/evin/evi) -- zonder splitsing werd meervoud
    // (evimiz/eviniz/evleri) vermoedelijk nooit specifiek geoefend.
    variants: [
      {id:"ben",   hint:"1st person singular \"my\" — e.g. \"evim\" (my house)"},
      {id:"sen",   hint:"2nd person singular \"your\" — e.g. \"evin\" (your house)"},
      {id:"o",     hint:"3rd person singular \"his/her/its\" — e.g. \"evi\" (his/her house)"},
      {id:"biz",   hint:"1st person plural \"our\" — e.g. \"evimiz\" (our house)"},
      {id:"siz",   hint:"2nd person plural/formal \"your\" — e.g. \"eviniz\" (your[pl./formal] house)"},
      {id:"onlar", hint:"3rd person plural \"their\" — e.g. \"evleri\" (their house)"},
    ]},
  {key:"bulunma_hali",    label:"Locative (-de/-da)",                hint:"location, e.g. \"evde\" (at home) — vary which of the vowel-harmony/hardening forms (-de/-da/-te/-ta) comes up across repeated exercises", minCefr:1},
  {key:"emir_kipi",       label:"Imperative (all persons)",          hint:"e.g. \"gel!\" (come!), \"gidin\" (go, pl./formal)", minCefr:2,
    variants: [
      {id:"sen",   hint:"informal singular \"sen\" imperative — e.g. \"gel!\" (come!)"},
      {id:"siz",   hint:"plural/formal \"siz\" imperative — e.g. \"gidin\" (go)"},
      {id:"3.kisi", hint:"3rd person imperative/optative (-sin/-sinler) — e.g. \"gelsin\" (let him/her come), \"gelsinler\" (let them come)"},
    ]},
  {key:"yonelme_hali",    label:"Dative (-e/-a)",                    hint:"direction/goal, e.g. \"okula gidiyorum\" (I'm going to school) — vary which of the vowel-harmony forms (-e/-a) comes up across repeated exercises", minCefr:2},
  {key:"ayrilma_hali",    label:"Ablative (-den/-dan)",              hint:"origin/from, e.g. \"okuldan geldim\" (I came from school) — vary which of the vowel-harmony/hardening forms (-den/-dan/-ten/-tan) comes up across repeated exercises", minCefr:2},
  {key:"belirtme_hali",   label:"Accusative (-i/-ı/-u/-ü)",          hint:"marks a definite direct object, e.g. \"kitabı okudum\" (I read the book) — vary which of the four vowel-harmony forms (-i/-ı/-u/-ü) comes up across repeated exercises", minCefr:2},
  {key:"gecmis_copula",   label:"Past copula -ydi",                  hint:"e.g. \"öğrenciydim\" (I was a student)", minCefr:3},
  {key:"yeterlik_kipi",   label:"Ability -ebilmek (can)",            hint:"e.g. \"gidebilirim\" (I can go), \"yüzebilir misin?\" (can you swim?)", minCefr:3,
    // Nieuw: was al opgesplitst in 5 lessons.json-lessen (iyor/ir/di/ecek/soru) maar zonder dat deze
    // variants-array bestond -- grammarTopicByKey viel dus stil terug op de kale topic voor alle 5,
    // waardoor elke les IN DE PRAKTIJK exact dezelfde (aorist-tijd) oefeningen genereerde, ongeacht
    // welke tijd de les beweerde te behandelen. Zie ook lessons.json (dezelfde 5 ids).
    variants: [
      {id:"iyor", hint:"present continuous ability \"-ebiliyor\" (currently able to/managing to) — e.g. \"gidebiliyorum\" (I'm currently able to go)"},
      {id:"ir",   hint:"general/aorist ability \"-ebilir\" (the neutral, everyday \"can\") — e.g. \"gidebilirim\" (I can go)"},
      {id:"di",   hint:"past ability \"-ebildi\" (was able to/managed to, and did) — e.g. \"gidebildim\" (I was able to go)"},
      {id:"ecek", hint:"future ability \"-ebilecek\" (will be able to) — e.g. \"gidebileceğim\" (I will be able to go)"},
      {id:"soru", hint:"yes/no question with the ability suffix, in any tense — e.g. \"Gidebilir misin?\" (Can you go?)"},
    ]},
  {key:"gecmis_di",       label:"Past tense -di (witnessed/certain)", hint:"e.g. \"geldim\" (I came)", minCefr:3},
  {key:"tamlayan_hali",   label:"Genitive (-in/-ın/-un/-ün)",        hint:"possession/compounds, e.g. \"annemin evi\" (my mother's house) — vary which of the four vowel-harmony forms (-in/-ın/-un/-ün) comes up across repeated exercises", minCefr:3},
  {key:"isim_tamlamasi",  label:"Noun compounds (isim tamlaması)",   hint:"e.g. \"araba anahtarı\" (car key), \"okulun bahçesi\" (the school's garden)", minCefr:4},
  {key:"hitap_bicimleri", label:"Address Forms & Politeness",        hint:"e.g. \"Ahmet Bey\" (Mr. Ahmet), \"anneciğim\" (mommy), sen vs. siz register", minCefr:4,
    variants: [
      {id:"titel",     hint:"honorific titles after a first name — e.g. \"Ahmet Bey\" (Mr. Ahmet), \"Ayşe Hanım\" (Mrs./Ms. Ayşe)"},
      {id:"diminutief", hint:"affectionate/diminutive address forms — e.g. \"anneciğim\" (mommy), \"canım\" (dear/darling)"},
      {id:"register",  hint:"the sen (informal) vs. siz (formal/plural) address register — e.g. asking the same thing with \"Nasılsın?\" (informal) vs. \"Nasılsınız?\" (formal)"},
    ]},
  {key:"edatlar",         label:"Postpositions (için, ile, göre, rağmen)", hint:"e.g. \"senin için\" (for you), \"buna rağmen\" (despite this)", minCefr:4,
    // BUGFIX: lessons.json splitst "için" al in drie lessen (amaç/neden/fayda), maar deze array had
    // tot nu toe maar één "icin"-variant -- de variant-lookup faalde dus voor alle drie için-lessen
    // en viel terug op de kale topic (dus voor/vanwege/ten behoeve van door elkaar).
    variants: [
      {id:"icin_amac",   hint:"\"için\" expressing PURPOSE (what something is for/in order to) — e.g. \"Bu para tatil için.\" (This money is for a vacation.), \"Türkçe öğrenmek için buradayım.\" (I'm here to learn Turkish.)"},
      {id:"icin_neden",  hint:"\"için\" expressing REASON/CAUSE (because of) — e.g. \"Trafik için geç kaldım.\" (I was late because of traffic.)"},
      {id:"icin_fayda",  hint:"\"için\" expressing BENEFIT/SAKE (for X's sake/behalf), most often with a personal pronoun — e.g. \"Senin için bir hediye aldım.\" (I bought a gift for you.)"},
      {id:"ile",     hint:"\"ile\" (with) — e.g. \"seninle\" (with you)"},
      {id:"gore",    hint:"\"göre\" (according to) — e.g. \"bana göre\" (according to me)"},
      {id:"ragmen",  hint:"\"rağmen\" (despite) — e.g. \"buna rağmen\" (despite this)"},
    ]},
  {key:"gelecek_zaman",   label:"Future tense -ecek",                hint:"e.g. \"geleceğim\" (I will come)", minCefr:4},
  {key:"karsilastirma",   label:"Comparison (daha, en, kadar, gibi)", hint:"e.g. \"ondan daha büyük\" (bigger than that)", minCefr:5,
    // BUGFIX: lessons.json splitst "kadar" al in twee lessen (equative vs. temporeel "until"), maar
    // deze array had tot nu toe maar één "kadar"-variant -- de variant-lookup faalde dus voor BEIDE
    // "kadar"-lessen en viel terug op de kale topic (dus altijd daha/en/kadar/gibi door elkaar).
    variants: [
      {id:"daha", hint:"\"daha\" comparative (-er/more) — e.g. \"ondan daha büyük\" (bigger than that)"},
      {id:"en",   hint:"\"en\" superlative (the most) — e.g. \"en büyük\" (the biggest)"},
      {id:"kadar_esitlik", hint:"\"kadar\" equative (as...as) — e.g. \"senin kadar uzun\" (as tall as you)"},
      {id:"kadar_zaman",   hint:"\"kadar\" temporal (until) — e.g. \"akşama kadar\" (until evening), \"eve varana kadar\" (until arriving home)"},
      {id:"gibi", hint:"\"gibi\" simile (like/as) — e.g. \"aslan gibi\" (like a lion)"},
    ]},
  {key:"genis_zaman",     label:"Aorist (general truth) -ir",        hint:"habits/facts, e.g. \"her gün koşarım\" (I run every day)", minCefr:5},
  {key:"baglaclar",       label:"Conjunctions (ki, hem...hem, ya...ya)", hint:"e.g. \"hem yorgunum hem açım\" (I'm both tired and hungry)", minCefr:6,
    // BUGFIX: lessons.json splitst "ki" al in vier lessen (that-clause/zodat/gevolg/verrassing), maar
    // deze array had tot nu toe maar één "ki"-variant -- de variant-lookup faalde dus voor alle vier
    // ki-lessen en viel terug op de kale topic (dus ki/hem/ya door elkaar, ongeacht welke les je opende).
    variants: [
      {id:"ki_dat",         hint:"\"ki\" as a relative \"that\"-clause linker — e.g. \"Bilirim ki sen haklısın.\" (I know that you're right.)"},
      {id:"ki_zodat",       hint:"\"ki\" expressing purpose (\"so that\") — e.g. \"Erken geldim ki seni görebileyim.\" (I came early so that I could see you.)"},
      {id:"ki_gevolg",      hint:"\"ki\" expressing result (\"so...that\") — e.g. \"O kadar yoruldum ki uyuyakaldım.\" (I got so tired that I fell asleep.)"},
      {id:"ki_verrassing",  hint:"\"ki\" for rhetorical surprise/emphasis at the end of a clause — e.g. \"Sen kimsin ki bana böyle konuşuyorsun?\" (Who are you [anyway] to talk to me like this?)"},
      {id:"hem_hem", hint:"\"hem...hem\" (both...and) — e.g. \"hem yorgunum hem açım\" (I'm both tired and hungry)"},
      {id:"ya_ya",   hint:"\"ya...ya\" (either...or) — e.g. \"ya gel ya git\" (either come or go)"},
    ]},
  {key:"vurgu_partikelleri", label:"Emphasis Particles (de/da, bile, üstelik, hatta)", hint:"e.g. \"ben de geliyorum\" (I'm coming too), \"bunu bile bilmiyor\" (he doesn't even know this)", minCefr:6,
    // BUGFIX: lessons.json splitst "de/da" al in drie lessen (additief/contrastief/nadruk), maar deze
    // array had tot nu toe maar één "de_da"-variant -- zelfde variant-lookup-bug als hierboven bij ki.
    variants: [
      {id:"de_da_ekleme",   hint:"additive \"de/da\" (also/too) — e.g. \"Ben de geliyorum.\" (I'm coming too.)"},
      {id:"de_da_karsit",   hint:"contrastive \"de/da\" (but/and yet) — e.g. \"Çalıştı da geçemedi.\" (He studied, but still couldn't pass.)"},
      {id:"de_da_vurgu",    hint:"intensifying \"de/da\" in an exclamation (how very...!) — e.g. \"Ne de güzel bir gün!\" (What a beautiful day!)"},
      {id:"bile",    hint:"\"bile\" (even) — e.g. \"bunu bile bilmiyor\" (he doesn't even know this)"},
      {id:"ustelik", hint:"\"üstelik\" (moreover/on top of that) — e.g. \"üstelik geç de kaldı\" (moreover, he was also late)"},
      {id:"hatta",   hint:"\"hatta\" (in fact/even) — e.g. \"hatta bana yardım etti\" (he even helped me)"},
    ]},
  {key:"gereklilik_kipi", label:"Necessitative -meli",               hint:"must/have to, e.g. \"gitmeliyim\" (I must go)", minCefr:6,
    // Nieuw: zelfde variant-lookup-bug als hierboven -- lessons.json had al 3 losse lessen
    // (heden/verleden/vraag) zonder dat deze array bestond.
    variants: [
      {id:"simdi",  hint:"present necessity \"-meli\" (must/should, now/in general) — e.g. \"Gitmeliyim.\" (I must go.)"},
      {id:"gecmis", hint:"past necessity \"-meliydi\" (should have/had to, retrospective) — e.g. \"Gitmeliydim.\" (I should have gone.)"},
      {id:"soru",   hint:"yes/no question with the necessitative suffix — e.g. \"Gitmeli miyim?\" (Must I go?)"},
    ]},
  {key:"gecmis_mis",      label:"Past tense -miş (hearsay/inferred)", hint:"e.g. \"gelmiş\" (apparently came)", minCefr:6,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 3 losse lessen (gehoord/afgeleid/verrassing)
    // zonder dat deze array bestond.
    variants: [
      {id:"duyum",   hint:"hearsay -miş: reporting something you were TOLD, not witnessed yourself — e.g. \"Ali gelmiş.\" (I heard/was told Ali came.)"},
      {id:"cikarim", hint:"inferential -miş: concluding something from visible evidence, not witnessed directly — e.g. \"Yağmur yağmış.\" (It must have rained — I see the wet ground.)"},
      {id:"sasirma", hint:"mirative -miş: expressing your own surprise at something you've just realized — e.g. \"Param bitmiş!\" (Oh, my money's run out! — surprised realization)"},
    ]},
  {key:"gecmis_devam",    label:"Past continuous -iyordu",           hint:"e.g. \"geliyordum\" (I was coming)", minCefr:7},
  {key:"sart_kipi",       label:"Conditional -se",                   hint:"if/should, e.g. \"gelirse\" (if he comes)", minCefr:7,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 2 losse lessen (werkwoord/naamwoord)
    // zonder dat deze array bestond.
    variants: [
      {id:"fiil", hint:"conditional on a VERB, suffix -se/-sa directly on the verb stem — e.g. \"gelirse\" (if he comes), \"gitseydi\" is a different, hypothetical-past form, stick to the plain \"-se/-sa\" here"},
      {id:"isim", hint:"conditional on a NOUN/ADJECTIVE predicate, via the conditional copula \"ise\"/\"-se\" — e.g. \"hasta ise\"/\"hastaysa\" (if [he] is sick), \"öğrenciyse\" (if [he] is a student)"},
    ]},
  {key:"istek_kipi",      label:"Optative (wish) -e",                hint:"e.g. \"gideyim\" (let me go)", minCefr:8},
  {key:"ki_eki",          label:"The suffix -ki (relative/possessive)", hint:"e.g. \"benimki\" (mine), \"masadaki kitap\" (the book on the table)", minCefr:8},
  {key:"madan_once",      label:"Converb -madan/-meden (without/before doing)", hint:"e.g. \"yemeden gitti\" (he left without eating), \"gitmeden önce\" (before going)", minCefr:8},
  {key:"gelecek_gecmis",  label:"Future-in-the-past -ecekti",        hint:"e.g. \"gelecekti\" (he was going to come)", minCefr:9},
  {key:"isim_fiil",       label:"Verbal nouns (-me/-iş)",            hint:"e.g. \"gitme\" (the going), \"gidiş\" (the departure)", minCefr:9},
  {key:"diginde",         label:"Converb -diğinde (when/at the time that)", hint:"e.g. \"eve geldiğinde\" (when he arrived home)", minCefr:9},
  {key:"inca",            label:"Converb -ınca (as soon as/when)",   hint:"e.g. \"okula varınca\" (as soon as he got to school)", minCefr:9},
  {key:"kucultme_eki",    label:"Diminutive -cik",                   hint:"e.g. \"azıcık\" (just a little bit)", minCefr:9},
  {key:"ortac",           label:"Participles (-en/-dik/-ecek)",      hint:"used as adjectives, e.g. \"gelen adam\" (the man who came), \"okuduğum kitap\" (the book I read)", minCefr:9,
    variants: [
      {id:"en",   hint:"agent participle -en (the one who does X) — e.g. \"gelen adam\" (the man who came)"},
      {id:"dik",  hint:"past/relative participle -dik (what X did/the fact that) — e.g. \"okuduğum kitap\" (the book I read)"},
      {id:"ecek", hint:"future participle -ecek (what will/is going to) — e.g. \"okuyacağım kitap\" (the book I will read)"},
    ]},
  {key:"birlesik_gecmis", label:"Compound past combinations -mişti", hint:"e.g. \"gitmişti\" (he had apparently gone)", minCefr:10},
  {key:"dolayli_anlatim", label:"Direct/indirect speech",            hint:"e.g. \"'geliyorum' dedi\" (he said 'I'm coming') vs \"geleceğini söyledi\" (he said he'd come)", minCefr:10,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 2 losse lessen (direct/indirect) zonder
    // dat deze array bestond.
    variants: [
      {id:"direct",   hint:"DIRECT speech: quoting the exact original words with \"dedi,\" no tense/person shift — e.g. \"'Geliyorum' dedi.\" (\"I'm coming,\" he said.)"},
      {id:"indirect", hint:"INDIRECT speech: reporting the content, verb turned into a verbal noun + possessive + söyledi/dedi, with pronoun/tense shifted to fit the reporter's perspective — e.g. \"Geleceğini söyledi.\" (He said he would come.)"},
    ]},
  {key:"dikce",           label:"Converb -dıkça (the more.../every time)", hint:"e.g. \"okudukça öğrenirsin\" (the more you read, the more you learn)", minCefr:11},
  {key:"zarf_fiil",       label:"Converbs (-erek, -ken)",             hint:"e.g. \"koşarak geldi\" (he came running), \"gelirken\" (while coming)", minCefr:10},
  {key:"edilgen_cati",    label:"Passive voice (-il/-in)",            hint:"e.g. \"kapı kapatıldı\" (the door was closed)", minCefr:11},
  {key:"islik_cati",      label:"Reciprocal voice -iş",               hint:"e.g. \"görüşmek\" (to see each other)", minCefr:11},
  {key:"ettirgen_cati",   label:"Causative (make/have done, -dir/-t)", hint:"e.g. \"yaptırdım\" (I had it made)", minCefr:12},
  {key:"donusluluk_cati", label:"Reflexive voice (-in)",              hint:"oneself, e.g. \"yıkandım\" (I washed myself)", minCefr:12},
  {key:"sart_bilesik",    label:"Compound conditional (hypothetical past, -seydi)", hint:"e.g. \"gitseydim\" (if I had gone), \"gitmiş olsaydı\" (if he had [reportedly] gone) — a hypothetical about something that did NOT happen, distinct from the basic -se conditional", minCefr:13},
  {key:"tezlik_fiili",    label:"Rapid-action verb -(y)Iver",         hint:"e.g. \"gidiver\" (just go / go right away), \"bakıver\" (just take a quick look) — adds a sense of speed, ease, or suddenness to the action", minCefr:13,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 2 losse lessen (gebiedende wijs/verteld)
    // zonder dat deze array bestond.
    variants: [
      {id:"emir",   hint:"-(y)Iver in the IMPERATIVE, a brisk/casual command — e.g. \"Gidiver!\" (Just go!/Go already!), \"Bakıver.\" (Just take a quick look.)"},
      {id:"anlati", hint:"-(y)Iver in a narrated past or future tense, describing a quick/easy completed or upcoming action — e.g. \"Hemen bitiriverdim.\" (I finished it right away.), \"Yarın halledeceğim.\" is NOT this form — use \"halliverecek\" (he'll just take care of it quickly)"},
    ]},
  {key:"rivayet_bilesik", label:"Compound hearsay tenses (-(i)yormuş, -mişmiş)", hint:"e.g. \"gidiyormuş\" (apparently he's going), \"gitmişmiş\" (apparently he had [reportedly] gone) — layering the hearsay/inferential -miş onto another tense, distinct from the simple -miş past", minCefr:14,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 2 losse lessen (-(i)yormuş/-mişmiş)
    // zonder dat deze array bestond.
    variants: [
      {id:"iyormus", hint:"hearsay layered onto the PRESENT CONTINUOUS: -(i)yormuş (apparently is/was doing) — e.g. \"Gidiyormuş.\" (Apparently he's going / was going, based on hearsay.)"},
      {id:"mismis",  hint:"hearsay layered onto the -miş PAST itself, doubling it: -mişmiş (apparently had [reportedly] done) — e.g. \"Gitmişmiş.\" (Apparently he had gone, [so I'm told].)"},
    ]},
  {key:"ileri_baglaclar", label:"Correlative conjunctions (ne...ne de, gerek...gerek, ister...ister)", hint:"e.g. \"ne çay ne de kahve\" (neither tea nor coffee), \"gerek anne gerek baba\" (both mother and father), \"ister gel ister gelme\" (whether you come or not) — paired conjunctions linking two items/options", minCefr:14,
    variants: [
      {id:"ne_ne_de",   hint:"\"ne...ne de\" (neither...nor) — e.g. \"ne çay ne de kahve\" (neither tea nor coffee)"},
      {id:"gerek_gerek", hint:"\"gerek...gerek\" (both...and) — e.g. \"gerek anne gerek baba\" (both mother and father)"},
      {id:"ister_ister", hint:"\"ister...ister\" (whether...or) — e.g. \"ister gel ister gelme\" (whether you come or not)"},
    ]},
  {key:"devrik_cumle",    label:"Inverted word order (devrik cümle) for emphasis", hint:"moving the verb away from its normal sentence-final position to emphasize another element, common in spoken/literary Turkish — e.g. \"Geldi mektup sonunda.\" (It arrived, the letter, finally — emphasizing \"geldi\") instead of the neutral \"Mektup sonunda geldi.\"", minCefr:15,
    // Stilistische keuze, geen verplichte constructie -- het neutrale alternatief is ook gewoon correct
    // Turks. Een productie-/vertaaloefening test dan niet of de gebruiker het HERKENT (zie ook ikileme
    // hieronder). recognitionStyle routeert dit onderwerp altijd via een herkennings-vraag (twee
    // voorbeeldzinnen, welke gebruikt de constructie) i.p.v. de gewone productieoefening.
    recognitionStyle: true},
  {key:"ileri_edatlar",   label:"Formal/written postpositions (dair, ilişkin, itibaren, nazaran)", hint:"e.g. \"bu konuya dair\" (regarding this matter), \"yarından itibaren\" (starting from tomorrow), \"geçen yıla nazaran\" (compared to last year) — more formal/written register than için/ile/göre/rağmen", minCefr:15,
    variants: [
      {id:"dair",     hint:"\"dair\" (regarding/concerning) — e.g. \"bu konuya dair\" (regarding this matter)"},
      {id:"iliskin",  hint:"\"ilişkin\" (related to/concerning) — e.g. \"bu karara ilişkin\" (related to this decision)"},
      {id:"itibaren", hint:"\"itibaren\" (starting from) — e.g. \"yarından itibaren\" (starting from tomorrow)"},
      {id:"nazaran",  hint:"\"nazaran\" (compared to) — e.g. \"geçen yıla nazaran\" (compared to last year)"},
    ]},
  {key:"ikileme",         label:"Reduplication / echo words (ikileme)", hint:"e.g. \"büyük büyük\" (huge, emphatic repetition), \"kitap mitap\" (books and such — dismissive echo-word), \"yemyeşil\" (intensely green — intensifying prefix reduplication)", minCefr:16,
    recognitionStyle: true, // zelfde reden als devrik_cumle hierboven
    variants: [
      {id:"emfatisch", hint:"emphatic word-doubling — e.g. \"büyük büyük\" (huge/really big, emphatic repetition)"},
      {id:"afwijzend", hint:"dismissive m-echo word (word + \"m\"-initial rhyming copy, meaning \"X and such/or whatever\") — e.g. \"kitap mitap\" (books and such)"},
      {id:"versterkend", hint:"intensifying reduplicated prefix before an adjective — e.g. \"yemyeşil\" (intensely green), \"masmavi\" (deep blue)"},
    ]},
  {key:"resmi_dil",       label:"Formal/bureaucratic register constructions", hint:"e.g. \"toplantının yapılmakta olduğu\" (the meeting that is [formally] taking place), \"geç kalınması durumunda\" (in the event of being late) — the nominalized, impersonal style used in official/written Turkish", minCefr:16},
  {key:"surerlik_fiili",  label:"Literary durative aspect -(y)Adur/-(y)Idur", hint:"e.g. \"bakadur\" (keep on looking), \"güledur\" (keep on laughing) — an archaic/literary construction for an ongoing action, rare in everyday speech", minCefr:17},
  {key:"atasozu_deyim",   label:"Proverbs & fixed idiomatic expressions", hint:"the grammatical patterns behind common Turkish proverbs/idioms — often elliptical or parallel structures, e.g. \"Ne ekersen onu biçersin.\" (You reap what you sow, lit. whatever you sow, that you harvest)", minCefr:17},
  {key:"var_yok",           label:"Existence & possession (var/yok)", hint:"e.g. \"param var\" (I have money, lit. my money exists), \"zamanım yok\" (I don't have time)", minCefr:0},
  {key:"soru_kelimeleri",   label:"Question words (ne/kim/nerede/ne zaman/nasıl/kaç/hangi/neden)", hint:"e.g. \"Bu ne?\" (What is this?), \"Nerede oturuyorsun?\" (Where do you live?)", minCefr:0,
    // Zeven losse ondervormen i.p.v. één gedeelde hint -- zie VARIANTS_NOTE hierboven grammarTopicByKey
    // voor waarom: zonder dit werd vrijwel altijd hetzelfde vraagwoord (meestal "ne") geoefend.
    // "neden" (waarom) nieuw toegevoegd (suffix-dekkingscontrole ronde 2) -- ontbrak eerder volledig.
    variants: [
      {id:"ne",       hint:"\"ne\" (what) — e.g. \"Bu ne?\" (What is this?)"},
      {id:"kim",      hint:"\"kim\" (who) — e.g. \"O kim?\" (Who is that?)"},
      {id:"nerede",   hint:"\"nerede\" (where) — e.g. \"Nerede oturuyorsun?\" (Where do you live?)"},
      {id:"nezaman",  hint:"\"ne zaman\" (when) — e.g. \"Ne zaman geliyorsun?\" (When are you coming?)"},
      {id:"nasil",    hint:"\"nasıl\" (how) — e.g. \"Nasılsın?\" (How are you?)"},
      {id:"kac",      hint:"\"kaç\" (how many/how much) — e.g. \"Kaç yaşındasın?\" (How old are you?)"},
      {id:"hangi",    hint:"\"hangi\" (which) — e.g. \"Hangi kitap?\" (Which book?)"},
      {id:"neden",    hint:"\"neden\"/\"niçin\"/\"niye\" (why, interchangeable, \"neden\" and \"niçin\" are the more neutral/written forms and \"niye\" the more casual/spoken one — vary between the three across calls) — e.g. \"Neden geç kaldın?\" (Why are you late?), \"Niye gülüyorsun?\" (Why are you laughing?)"},
    ]},
  {key:"isaret_zamirleri",  label:"Demonstrative pronouns (bu/şu/o)", hint:"e.g. \"bu kitap\" (this book, near speaker), \"şu adam\" (that man, near listener), \"o ev\" (that house, far from both)", minCefr:1,
    // Drie losse ondervormen -- zie de toelichting bij grammarTopicByKey/getTopicProgress hieronder.
    // Zonder dit koos de AI vrijwel altijd "bu" (de prototypische/makkelijkste vorm), en telde dat als
    // voortgang op het HELE onderwerp mee, waardoor şu en o nooit echt geoefend werden.
    variants: [
      {id:"bu", hint:"\"bu\" (this, near the speaker) — e.g. \"bu kitap\" (this book), \"Bunu istiyorum.\" (I want this one)"},
      {id:"su", hint:"\"şu\" (that, near the listener / pointed out close by) — e.g. \"şu adam\" (that man), \"Şunu görüyor musun?\" (Do you see that one?)"},
      {id:"o",  hint:"\"o\" (that, far from both speaker and listener) — e.g. \"o ev\" (that house), \"O kadın öğretmen.\" (That woman is a teacher)"},
    ]},
  {key:"zarflar",           label:"Adverbs — formation & position", hint:"e.g. \"hızlı\" (fast, adjective) vs \"hızlıca\"/\"hızlı\" (quickly, adverb) — most Turkish adverbs are unmarked or use -ca/-ce", minCefr:4,
    variants: [
      {id:"vorming", hint:"how an adverb is FORMED from an adjective (unmarked, or with -ca/-ce) — e.g. \"hızlı\" (fast) -> \"hızlıca\"/\"hızlı\" (quickly)"},
      {id:"positie", hint:"where the adverb is PLACED in the sentence (typically right before the verb it modifies) — e.g. \"çok hızlı koştu\" (he ran very fast)"},
    ]},
  {key:"arac_hali",         label:"Instrumental case (-(y)la/-(y)le)", hint:"e.g. \"otobüsle\" (by bus), \"kalemle yazdım\" (I wrote with a pen) — the suffixed form of \"ile\" — vary which of the two vowel-harmony forms (-(y)la/-(y)le) comes up across repeated exercises", minCefr:6,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 3 losse lessen (instrumentaal/comitatief/
    // voegwoord) zonder dat deze array bestond.
    variants: [
      {id:"instrumentaal", hint:"instrumental \"with what/by means of\" (a tool/method) — e.g. \"kalemle yazdım\" (I wrote with a pen), \"otobüsle geldim\" (I came by bus)"},
      {id:"comitatief",    hint:"comitative \"with whom\" (accompaniment) — e.g. \"arkadaşımla geldim\" (I came with my friend)"},
      {id:"baglac",        hint:"conjunctive use, linking two nouns like \"and\" — e.g. \"çayla kahve\" (tea and coffee), equivalent to \"çay ve kahve\""},
    ]},
  {key:"belirsiz_zamirler", label:"Indefinite pronouns & quantifiers", hint:"e.g. \"biri\" (someone), \"herkes\" (everyone), \"hiç kimse\" (no one), \"bazı\" (some), \"her\" (every)", minCefr:6,
    variants: [
      {id:"biri",     hint:"\"biri\" (someone/one of them) — e.g. \"biri geldi\" (someone came)"},
      {id:"herkes",   hint:"\"herkes\" (everyone) — e.g. \"herkes biliyor\" (everyone knows)"},
      {id:"kimse",    hint:"\"hiç kimse\" (no one) — e.g. \"hiç kimse gelmedi\" (no one came)"},
      {id:"bazi",     hint:"\"bazı\" (some) — e.g. \"bazı insanlar\" (some people)"},
      {id:"her",      hint:"\"her\" (every) — e.g. \"her gün\" (every day)"},
    ]},
  {key:"kendi_zamiri",      label:"The reflexive pronoun kendi", hint:"e.g. \"kendim\" (myself), \"kendine bak\" (look after yourself) — distinct from the reflexive verb suffix -in", minCefr:8,
    // Nieuw: zelfde variant-lookup-bug -- lessons.json had al 3 losse lessen (object/nadruk/bezit)
    // zonder dat deze array bestond.
    variants: [
      {id:"nesne",  hint:"kendi as a reflexive OBJECT (myself/yourself/...), taking a case suffix — e.g. \"Kendimi gördüm.\" (I saw myself.), \"Kendine iyi bak.\" (Take good care of yourself.)"},
      {id:"vurgu",  hint:"kendi for EMPHASIS, alongside a subject pronoun, meaning \"...myself/personally\" — e.g. \"Ben kendim yaptım.\" (I did it myself.)"},
      {id:"iyelik", hint:"kendi + possessive suffix meaning \"my/your/... OWN\" — e.g. \"Kendi evim var.\" (I have my own house.)"},
    ]},
  {key:"diktan_sonra",      label:"Converb -DIktan sonra (after doing)", hint:"e.g. \"yemek yedikten sonra\" (after eating), \"eve geldikten sonra\" (after coming home) — the counterpart to -madan önce", minCefr:8},
  {key:"ip_baglaci",        label:"Converb -Ip (sequential actions)", hint:"e.g. \"gidip aldım\" (I went and got it), \"alıp geldi\" (he took it and came) — links same-subject actions without repeating tense/person", minCefr:9},
  {key:"yardimci_fiiller",  label:"Light verb constructions (etmek/olmak/yapmak)", hint:"e.g. \"yardım etmek\" (to help), \"teşekkür etmek\" (to thank), \"hasta olmak\" (to become sick)", minCefr:10,
    variants: [
      {id:"etmek",  hint:"light verb \"etmek\" (to do/perform, with a borrowed/Arabic-origin noun) — e.g. \"yardım etmek\" (to help), \"teşekkür etmek\" (to thank)"},
      {id:"olmak",  hint:"light verb \"olmak\" (to become) — e.g. \"hasta olmak\" (to become sick), \"mutlu olmak\" (to become/be happy)"},
      {id:"yapmak", hint:"light verb \"yapmak\" (to do/make, with a native Turkish noun) — e.g. \"yardım yapmak\" (to do a favor/help), \"spor yapmak\" (to do sports)"},
    ]},
  {key:"aliskanlik_gecmis", label:"Habitual past — \"used to\" (-ArdI)", hint:"e.g. \"eskiden sigara içerdim\" (I used to smoke), \"her gün koşardık\" (we used to run every day)", minCefr:10},
  // Nieuw (suffix-dekkingscontrole): vier veelvoorkomende achtervoegsels die nog geen eigen les hadden.
  // -ken (terwijl/toen) bleef expres BUITEN deze lijst -- dat zit al (samen met -erek) in zarf_fiil
  // hierboven ("Converbs -erek, -ken").
  {key:"lik_eki",          label:"Abstract noun suffix -lik/-lık", hint:"turns an adjective or noun into an abstract quality/state noun, e.g. \"güzellik\" (beauty, from güzel \"beautiful\"), \"temizlik\" (cleanliness, from temiz \"clean\"), \"çocukluk\" (childhood, from çocuk \"child\") — vary which of the four vowel-harmony forms (-lik/-lık/-luk/-lük) comes up across repeated exercises", minCefr:4},
  {key:"li_siz_eki",       label:"Having/without suffix -li/-lı vs. -siz/-sız", hint:"attached to a noun to mean \"having X\" (-li/-lı/-lu/-lü) or \"without X\" (-siz/-sız/-suz/-süz), e.g. \"tuzlu\" (salty, having salt) vs. \"tuzsuz\" (unsalted, without salt), \"şekerli\" (sweetened) vs. \"şekersiz\" (unsweetened)", minCefr:4,
    variants: [
      {id:"sahip",   hint:"\"-li/-lı\" (having X) — e.g. \"tuzlu\" (salty, having salt), \"şekerli\" (sweetened, having sugar)"},
      {id:"yoksun",  hint:"\"-siz/-sız\" (without X) — e.g. \"tuzsuz\" (unsalted, without salt), \"şekersiz\" (unsweetened, without sugar)"},
    ]},
  // Let op: dit is de COPULA-uitgang -dir/-dır (aanname/generalisatie, bv. "öğrencidir"), NIET dezelfde
  // klank als de causatief-uitgang -dir bij ettirgen_cati hierboven (bv. "yaptırdım") -- dat is een
  // compleet ander achtervoegsel dat toevallig hetzelfde klinkt. Hint benadrukt dit verschil expliciet
  // zodat de AI de twee niet door elkaar haalt.
  {key:"genelleme_diri",   label:"Generalization/assumption copula suffix -dir/-dır", hint:"attached to a noun/adjective predicate to mark a general truth, formal assumption, or written-register certainty, e.g. \"öğrencidir\" (he is presumably/generally a student), \"İstanbul büyük bir şehirdir.\" (Istanbul is a big city) — common in formal writing, dictionary definitions, and news; NOT the same suffix as the causative -dir/-t (\"yaptırdım\" = I had it made), which is a completely different, coincidentally similar-sounding ending", minCefr:7},
  {key:"ce_eki",           label:"Manner/opinion suffix -ce/-ca", hint:"attached to an adjective to mean \"in a ... way\" (e.g. \"hızlıca\" = quickly, from hızlı \"fast\"), or to a personal pronoun to mean \"in X's opinion\" (e.g. \"bence\" = in my opinion, from ben \"I\"); also used for language names (e.g. \"Türkçe\" = the Turkish language, from Türk)", minCefr:6,
    variants: [
      {id:"zarf",   hint:"adverbial \"in a ... way\" (attached to an adjective) — e.g. \"hızlıca\" (quickly, from hızlı \"fast\"), \"sessizce\" (silently, from sessiz \"quiet\")"},
      {id:"gorus",  hint:"\"in X's opinion\" (attached to a personal pronoun) — e.g. \"bence\" (in my opinion, ben+ce), \"sence\" (in your opinion, sen+ce), \"ona göre değil, onca\" is NOT used — stick to bence/sence/bizce/sizce, the genuinely common forms"},
    ]},
  // Nieuw (suffix-dekkingscontrole ronde 2, n.a.v. vergelijking met een extern referentieboek): twee
  // ontbrekende achtervoegsels plus een ontbrekende variant in een bestaand onderwerp.
  {key:"ci_eki",           label:"Agent/profession suffix -ci/-çi", hint:"turns a noun into \"one who does/deals with X\" -- a person's job or specialization, e.g. \"gazete\" (newspaper) → \"gazeteci\" (journalist), \"iş\" (work) → \"işçi\" (worker), \"süt\" (milk) → \"sütçü\" (milkman) -- vary which of the four vowel-harmony forms (-ci/-çi/-cı/-çı/-cu/-çu/-cü/-çü, with devoicing to ç after a voiceless final consonant) comes up across repeated exercises. NOT the same suffix as -lik/-lık (which forms the ABSTRACT profession/quality, e.g. \"öğretmenlik\" = the teaching profession, vs. \"öğretmen\" = teacher, a plain noun with no suffix needed for the person).", minCefr:4},
  // -miş als COPULA (op een naamwoord/bijvoeglijk naamwoord predicaat, bv. "öğrenciymiş") is een ander
  // gebruik dan gecmis_mis hierboven (dat behandelt uitsluitend de WERKWOORD-vervoeging, bv. "gelmiş").
  // Zelfde tweeledige opsplitsing als bij gecmis_di (werkwoord) vs. gecmis_copula (naamwoord) hierboven.
  {key:"mis_copula",       label:"Hearsay/inferential copula -(y)mış", hint:"attached to a noun/adjective predicate (not a verb) to report something you heard secondhand or inferred, rather than witnessed directly -- e.g. \"öğrenciymiş\" (apparently he/she is a student, based on hearsay), \"hastaymış\" (apparently sick). This is the COPULA use of -mış -- distinct from gecmis_mis, which is the same suffix attached to a VERB instead (e.g. \"gelmiş\" = apparently came); the same is true here as for the -di past: -di attaches to a verb, -ydi is its copula counterpart on a noun/adjective, and -mış/-ymış work the same way.", minCefr:6},
];
