import 'dotenv/config';
import { PrismaClient, type Category } from '@prisma/client';

const prisma = new PrismaClient();

// Phase 1 ships with hand-written seed content — there is no user-generated
// quest supply yet. Set SEED_CITY to the city/campus you are launching in;
// the city-tagged quests below get filed under it, and everything with
// city: null shows up everywhere.
const CITY = process.env.SEED_CITY ?? 'Boston';

/** Quests available to every user regardless of where they are. */
interface SeedQuest {
  title: string;
  description: string;
  category: Category;
  durationMin: number;
  difficulty: number;
}

interface SeedMini {
  title: string;
  prompt: string;
  category: Category;
}

const everywhereQuests: SeedQuest[] = [
  {
    title: 'Sunrise somewhere new',
    description: 'Watch the sun come up from a spot you have never seen it from.',
    category: 'NATURE',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Order the thing you always skip',
    description: 'Go to a familiar place and order the item you have never once tried.',
    category: 'FOOD_DRINK',
    durationMin: 30,
    difficulty: 1,
  },
  {
    title: 'Walk a street you have never walked',
    description:
      'Pick a street you pass constantly but have never gone down. Walk the whole thing.',
    category: 'ADVENTURE',
    durationMin: 30,
    difficulty: 1,
  },
  {
    title: 'Cook something from another country',
    description: 'Pick a cuisine you have never cooked and make one dish from scratch.',
    category: 'FOOD_DRINK',
    durationMin: 90,
    difficulty: 2,
  },
  {
    title: 'Read in a park for an hour',
    description: 'No phone. One book, one bench, sixty minutes.',
    category: 'CULTURE',
    durationMin: 60,
    difficulty: 1,
  },
  {
    title: 'Take the last stop',
    description:
      'Get on a bus or train and ride it to the end of the line. Look around before you come back.',
    category: 'ADVENTURE',
    durationMin: 90,
    difficulty: 2,
  },
  {
    title: 'Swim outdoors',
    description: 'Lake, ocean, river, quarry — anywhere without a roof over it.',
    category: 'NATURE',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Learn a song end to end',
    description: 'Any instrument, any song. Play it through without stopping.',
    category: 'CREATIVE',
    durationMin: 120,
    difficulty: 3,
  },
  {
    title: 'Run 5K without stopping',
    description: 'Slow counts. Finishing is the whole quest.',
    category: 'FITNESS',
    durationMin: 40,
    difficulty: 2,
  },
  {
    title: 'Draw a stranger',
    description: 'Sit somewhere public and sketch someone. They never have to know.',
    category: 'CREATIVE',
    durationMin: 30,
    difficulty: 1,
  },
  {
    title: 'Find live music you have not heard of',
    description: 'Show up to a set by an artist you cannot name beforehand.',
    category: 'CULTURE',
    durationMin: 120,
    difficulty: 2,
  },
  {
    title: 'Climb something with a view',
    description: 'Hill, tower, stairwell, fire escape you are allowed on. Get above the roofline.',
    category: 'ADVENTURE',
    durationMin: 90,
    difficulty: 2,
  },
  {
    title: 'Eat somewhere with no English menu',
    description: 'Point at something. Find out what it is afterwards.',
    category: 'FOOD_DRINK',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Stargaze away from streetlights',
    description: 'Get far enough out that you can actually see them.',
    category: 'NATURE',
    durationMin: 90,
    difficulty: 3,
  },
  {
    title: 'Visit a museum you have walked past',
    description: 'The one you have been meaning to for a year. Today.',
    category: 'CULTURE',
    durationMin: 120,
    difficulty: 1,
  },
  {
    title: 'Sunset picnic',
    description: 'Food you packed yourself, somewhere with a horizon.',
    category: 'FOOD_DRINK',
    durationMin: 90,
    difficulty: 1,
  },
  {
    title: 'Try a workout class you would never pick',
    description: 'The one that sounds slightly embarrassing. That one.',
    category: 'FITNESS',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Photograph the same spot at dawn and dusk',
    description: 'Same frame, twelve hours apart. Post both.',
    category: 'CREATIVE',
    durationMin: 30,
    difficulty: 2,
  },
  {
    title: 'Hike somewhere with no phone signal',
    description: 'Far enough out that the bars actually disappear.',
    category: 'NATURE',
    durationMin: 180,
    difficulty: 3,
  },
  {
    title: 'Learn 20 words of a new language',
    description: 'Twenty words, out loud, to an actual person.',
    category: 'CULTURE',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Bike somewhere you would normally drive',
    description: 'Whole trip, both directions.',
    category: 'FITNESS',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Make something with your hands',
    description: 'Pottery, woodwork, knitting, bread. Something that exists when you are done.',
    category: 'CREATIVE',
    durationMin: 120,
    difficulty: 2,
  },
  {
    title: 'Say yes to the next invitation',
    description: 'Whatever it is, whoever it is from. Go.',
    category: 'ADVENTURE',
    durationMin: 120,
    difficulty: 2,
  },
  {
    title: 'Coffee at a place with no chain sign',
    description: 'Independent only. Sit in, do not take away.',
    category: 'FOOD_DRINK',
    durationMin: 45,
    difficulty: 1,
  },
  {
    title: 'Watch a film in a language you do not speak',
    description: 'Subtitles allowed. Dubbing is not.',
    category: 'CULTURE',
    durationMin: 120,
    difficulty: 1,
  },
  {
    title: 'Walk 10km in one go',
    description: 'One walk, no transport, no shortcuts.',
    category: 'FITNESS',
    durationMin: 150,
    difficulty: 3,
  },
];

/** City / campus quests — the local layer that makes the feed feel specific. */
const cityQuests: SeedQuest[] = [
  {
    title: 'Find the oldest building downtown',
    description:
      'Track down the oldest standing building in the city centre and stand in front of it.',
    category: 'CULTURE',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Eat at the place with the longest queue',
    description: 'Whichever spot has the line out the door this week. Join it.',
    category: 'FOOD_DRINK',
    durationMin: 90,
    difficulty: 2,
  },
  {
    title: 'Cross the river on foot',
    description: 'Whichever bridge you have never walked. Both directions.',
    category: 'ADVENTURE',
    durationMin: 45,
    difficulty: 1,
  },
  {
    title: 'Find the best rooftop in the city',
    description: 'Public, paid, or a friend with a good building. Get up there.',
    category: 'ADVENTURE',
    durationMin: 90,
    difficulty: 2,
  },
  {
    title: 'Visit the campus library you never study in',
    description: 'Every campus has one. Sit in it for an hour.',
    category: 'CULTURE',
    durationMin: 60,
    difficulty: 1,
  },
  {
    title: 'Do a lap of the biggest park in town',
    description: 'The full perimeter, not the shortcut through the middle.',
    category: 'NATURE',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Try the student-special everyone mentions',
    description: 'The cheap meal deal everyone on campus talks about. Find out if it holds up.',
    category: 'FOOD_DRINK',
    durationMin: 45,
    difficulty: 1,
  },
  {
    title: 'Go to a game of a sport you do not follow',
    description: 'Local team, any sport, cheapest seat.',
    category: 'FITNESS',
    durationMin: 150,
    difficulty: 1,
  },
  {
    title: "Find the city's best-kept mural",
    description: 'Not the famous one. The one down a side street.',
    category: 'CREATIVE',
    durationMin: 45,
    difficulty: 2,
  },
  {
    title: 'Ride the whole transit line',
    description: 'End to end on the longest line in the city, one sitting.',
    category: 'ADVENTURE',
    durationMin: 120,
    difficulty: 2,
  },
  {
    title: 'Farmers market before 9am',
    description: 'Go early, buy something you cannot identify.',
    category: 'FOOD_DRINK',
    durationMin: 60,
    difficulty: 1,
  },
  {
    title: 'Find the highest public point in the city',
    description: 'The highest spot anyone can stand for free. Get there.',
    category: 'NATURE',
    durationMin: 120,
    difficulty: 3,
  },
  {
    title: 'Attend a free campus lecture outside your field',
    description: 'Anything you are not registered for. Sit at the front.',
    category: 'CULTURE',
    durationMin: 90,
    difficulty: 1,
  },
  {
    title: 'Swim at the local pool before class',
    description: 'In the water before your first lecture of the day.',
    category: 'FITNESS',
    durationMin: 60,
    difficulty: 2,
  },
  {
    title: 'Find the late-night food institution',
    description: 'The place everyone ends up at 2am. Go, at 2am.',
    category: 'FOOD_DRINK',
    durationMin: 45,
    difficulty: 2,
  },
  {
    title: 'Photograph your city from across the water',
    description: 'Get to the other side and shoot the skyline.',
    category: 'CREATIVE',
    durationMin: 120,
    difficulty: 2,
  },
  {
    title: 'Walk the length of the main street',
    description: 'Every block, one end to the other, no detours.',
    category: 'ADVENTURE',
    durationMin: 60,
    difficulty: 1,
  },
  {
    title: 'Find a bookshop with a cat in it',
    description: 'Independent bookshop, resident animal. They exist.',
    category: 'CULTURE',
    durationMin: 45,
    difficulty: 2,
  },
];

/** Fixed 20-mini pool, cycled 4 a day. Deliberately low-effort — a mini is the
 *  escape hatch that keeps a streak alive on a bad day. */
const minis: SeedMini[] = [
  {
    title: 'Ten-minute walk',
    prompt: 'Leave the building, walk ten minutes, come back a different way.',
    category: 'FITNESS',
  },
  {
    title: 'New drink',
    prompt: 'Order something you have never ordered before.',
    category: 'FOOD_DRINK',
  },
  {
    title: 'One photo',
    prompt: 'Take one photo of something you would normally walk past.',
    category: 'CREATIVE',
  },
  {
    title: 'Talk to a stranger',
    prompt: 'Start one conversation with someone you do not know.',
    category: 'ADVENTURE',
  },
  {
    title: 'Look up',
    prompt: 'Find something above eye level on a building you pass daily.',
    category: 'CULTURE',
  },
  {
    title: 'Sit outside',
    prompt: 'Spend fifteen minutes outdoors doing nothing in particular.',
    category: 'NATURE',
  },
  {
    title: 'Stretch properly',
    prompt: 'Ten minutes of actual stretching, not the thirty-second version.',
    category: 'FITNESS',
  },
  {
    title: 'Write three lines',
    prompt: 'Three sentences about today. Nobody has to read them.',
    category: 'CREATIVE',
  },
  {
    title: 'New route home',
    prompt: 'Get home a way you have never taken.',
    category: 'ADVENTURE',
  },
  {
    title: 'Find something green',
    prompt: 'Locate the nearest tree you cannot name and look it up.',
    category: 'NATURE',
  },
  {
    title: 'Cook one thing',
    prompt: 'Make one thing from scratch instead of buying it.',
    category: 'FOOD_DRINK',
  },
  {
    title: 'Read five pages',
    prompt: 'Five pages of anything that is not a screen.',
    category: 'CULTURE',
  },
  { title: 'Stairs only', prompt: 'No lifts or escalators for a whole day.', category: 'FITNESS' },
  {
    title: 'Compliment someone',
    prompt: 'Say one genuine thing to someone out loud.',
    category: 'ADVENTURE',
  },
  {
    title: 'Learn one word',
    prompt: 'One new word in a language you are not fluent in. Use it.',
    category: 'CULTURE',
  },
  {
    title: 'Draw for five minutes',
    prompt: 'Five minutes, any subject, no erasing.',
    category: 'CREATIVE',
  },
  {
    title: 'Watch the sky change',
    prompt: 'Be outside for either sunrise or sunset today.',
    category: 'NATURE',
  },
  {
    title: 'Phone-free meal',
    prompt: 'Eat one meal with your phone in another room.',
    category: 'FOOD_DRINK',
  },
  {
    title: 'Twenty push-ups',
    prompt: 'Across the day, in as many sets as you need.',
    category: 'FITNESS',
  },
  {
    title: 'Ask for a recommendation',
    prompt: 'Ask someone for one thing to do in this city and note it down.',
    category: 'ADVENTURE',
  },
];

async function main() {
  // Quests are matched by title so re-running the seed tops up content
  // without duplicating what is already there or wiping completions.
  for (const quest of everywhereQuests) {
    const existing = await prisma.quest.findFirst({ where: { title: quest.title, city: null } });
    if (existing) {
      await prisma.quest.update({ where: { id: existing.id }, data: quest });
    } else {
      await prisma.quest.create({ data: { ...quest, city: null } });
    }
  }

  for (const quest of cityQuests) {
    const existing = await prisma.quest.findFirst({ where: { title: quest.title, city: CITY } });
    if (existing) {
      await prisma.quest.update({ where: { id: existing.id }, data: quest });
    } else {
      await prisma.quest.create({ data: { ...quest, city: CITY } });
    }
  }

  for (const [slot, mini] of minis.entries()) {
    await prisma.miniQuest.upsert({
      where: { slot },
      update: mini,
      create: { slot, ...mini },
    });
  }

  const [questCount, miniCount] = await Promise.all([
    prisma.quest.count(),
    prisma.miniQuest.count(),
  ]);

  console.log(
    `Seeded: ${questCount} quests (${everywhereQuests.length} everywhere + ${cityQuests.length} in ${CITY}), ${miniCount} mini quests.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
