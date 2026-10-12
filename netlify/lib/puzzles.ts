export type Puzzle = {
  word: string;
  cipher: string;
  note: string;
  clues: [string, string, string];
};

export const puzzles: Puzzle[] = [
  { word: "HARBOR", cipher: "KDUERU", note: "A Caesar shift of +3 was used. Move every letter back three places.", clues: ["Ships shelter here when the weather turns rough.", "A port is another name for it.", "It begins with H and ends with R."] },
  { word: "LANTERN", cipher: "12-1-14-20-5-18-14", note: "Numbers stand for letters: A=1, B=2, and so on.", clues: ["A portable light used before electric torches were common.", "It often has a handle and a glass cover.", "It starts with L and has seven letters."] },
  { word: "BRIDGE", cipher: "CSJEHF", note: "Each letter in the intercept is one step AFTER its partner. Step back once.", clues: ["It lets people cross over an obstacle.", "A card game and a ship's command room share this word.", "It begins with B and has six letters."] },
  { word: "ORCHARD", cipher: "A GARDEN THAT BEARS FRUIT", note: "The intercept describes the hidden word rather than spelling it.", clues: ["Fruit trees grow together in this place.", "It may contain apple, pear, or cherry trees.", "It begins with O and has seven letters."] },
  { word: "COMPASS", cipher: "3-15-13-16-1-19-19", note: "Decode the alphabet positions with A=1 and Z=26.", clues: ["A navigator uses this to find direction.", "Its needle points toward magnetic north.", "It begins with C and has seven letters."] },
  { word: "CIPHER", cipher: "F I P H E C", note: "The letters were received out of order. Rearrange them into a secret writing method.", clues: ["A secret method for writing messages.", "It can replace letters with symbols or other letters.", "It begins with C and has six letters."] },
  { word: "TUNNEL", cipher: "GHAARY", note: "A Caesar shift of +13 was used. Move every letter back thirteen places.", clues: ["A passage that runs under the ground or through a hill.", "Trains, cars, and pedestrians can travel through one.", "It begins with T and has six letters."] },
  { word: "SIGNAL", cipher: "19 · 9 · 7 · 14 · 1 · 12", note: "Numbers stand for letters: A=1, B=2, and so on.", clues: ["A message sent by light, sound, or radio.", "It can warn, guide, or call someone.", "It begins with S and has six letters."] },
  { word: "ASTROLABE", cipher: "DVWURODEH", note: "A Caesar shift of +3 was used. Move every letter back three places.", clues: ["An old navigation instrument used before modern electronics.", "Sailors used it to measure the height of stars.", "It begins with A and has nine letters."] },
  { word: "ECLIPSE", cipher: "HFOLSVH", note: "A Caesar shift of +3 was used. Move every letter back three places.", clues: ["One celestial body blocks the light from another.", "It can darken the day when the moon crosses the sun.", "It begins with E and has seven letters."] },
  { word: "WHISPER", cipher: "23-8-9-19-16-5-18", note: "Numbers stand for letters: A=1, B=2, and so on.", clues: ["A very quiet way to speak.", "It carries farther when the room is silent.", "It begins with W and has seven letters."] },
  { word: "KEYHOLE", cipher: "H O L E K Y E", note: "The letters were received out of order. Rearrange them into a small opening in a lock.", clues: ["A small opening where a key is inserted.", "Someone might peek through one in a door.", "It begins with K and has seven letters."] },
  { word: "PARACHUTE", cipher: "16-1-18-1-3-8-21-20-5", note: "Numbers stand for letters: A=1, B=2, and so on.", clues: ["A fabric canopy that slows a person's fall.", "It can be packed into a harness for a jump from an aircraft.", "It begins with P and has nine letters."] },
  { word: "VOLCANO", cipher: "YROFDQR", note: "A Caesar shift of +3 was used. Move every letter back three places.", clues: ["An opening in Earth's crust that can release lava.", "Some are quiet for centuries before erupting.", "It begins with V and has seven letters."] },
  { word: "SATELLITE", cipher: "19 · 1 · 20 · 5 · 12 · 12 · 9 · 20 · 5", note: "Numbers stand for letters: A=1, B=2, and so on.", clues: ["An object that travels around a planet.", "It can relay calls, images, and weather data from orbit.", "It begins with S and has nine letters."] },
  { word: "WATERFALL", cipher: "YCVGTHCNN", note: "A Caesar shift of +2 was used. Move every letter back two places.", clues: ["A river drops over a steep edge in one of these.", "The water crashes into a pool or stream below.", "It begins with W and has nine letters."] },
];
