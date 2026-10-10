import React from 'react';
import glyphs from '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import material from '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
export function Ionicons({name,size=20,color}:any){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,flexShrink:0}}>{String.fromCodePoint(glyphs[name]||glyphs['ellipse-outline'])}</span>}
export function MaterialCommunityIcons({name,size=20,color}:any){return <span aria-hidden="true" style={{fontFamily:'MaterialCommunityIcons',fontSize:size,color,flexShrink:0}}>{String.fromCodePoint(material[name]||material.brain)}</span>}
