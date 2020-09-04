'use strict';

const gulp = require('gulp');
const plugins = require('gulp-load-plugins')();
const del = require('del');

gulp.task('lint', function () {
  return gulp.src(['./lib/**/*.js', './test/**/*.js', 'gulpfile.js'])
    .pipe(plugins.eslint())
    .pipe(plugins.eslint.format())
    .pipe(plugins.eslint.failAfterError());
});

gulp.task('watch', ['lint'], function () {
  gulp.watch(['./lib/**/*.js'], ['lint']);
  gulp.watch(['gulpfile.js', './test/**/*.js'], ['lint']);
});

gulp.task('clean', function () {
  return del([
    'reports', 'docs', 'test-dist'
  ]);
});

gulp.task('show-coverage', function () {
  return gulp.src('./coverage/index.html')
    .pipe(plugins.open());
});

gulp.task('default', ['watch']);
