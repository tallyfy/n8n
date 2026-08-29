const { src, dest } = require('gulp');

function copyIcons() {
	return src('nodes/**/*.svg.notreal')
		.pipe(dest('dist/nodes'));
}

exports['build:icons'] = copyIcons;