import React from 'react';
import {View} from 'react-native-web';
export function LinearGradient({colors,style,children,...props}:any){return <View {...props} style={[{backgroundImage:`linear-gradient(135deg, ${colors.join(',')})`},style]}>{children}</View>}
export function BlurView({intensity,tint,...props}:any){return <View {...props}/>}
